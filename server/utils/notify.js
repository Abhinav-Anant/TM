const Notification = require('../model/notification.model.js');
const User = require('../model/user.model.js');
const { push } = require('./sse.js');
const { sendWhatsApp, whatsappEnabled, companyNumber } = require('./whatsapp.js');
const { departmentHeadsOf, departmentMemberIds, headedDepartmentIds } = require('./scope.js');
const { sendEmail, emailEnabled } = require('./email.js');
const { sendPush } = require('./push.js');
const { registerJob, enqueue, acquireLock } = require('./jobs.js');
const { eventFor, wants } = require('./notificationPrefs.js');

const CLIENT_URL = process.env.CLIENT_URL || "";

// Must stay above the gateway's Safe Mode minimum gap (1s at its most permissive
// tier) or paced sends still get rejected. Set to 0 in tests to keep them quick.
const SEND_GAP_MS = Number(process.env.WHATSAPP_SEND_GAP_MS ?? 1200);

// ---- delivery jobs: slow or fallible channels run in the queue, never inside a request ----------
registerJob("whatsapp", async ({ to, text, from }) => {
    // The gateway rejects (not queues) sends that come too fast from one number. One slot per sending
    // number, shared across ALL app instances: whoever wins it sends, everyone else reschedules.
    if (SEND_GAP_MS > 0) {
        const slot = await acquireLock(`whatsapp-slot:${from || "company"}`, SEND_GAP_MS);
        if (!slot.ok) return { retryAt: slot.until };
    }
    let result = await sendWhatsApp({ to, text, from });
    // The sender's phone dropped off since this was queued: the company number carries it if there is
    // one; otherwise the in-app alert already covered it and there is nothing to retry.
    if (result === "not-linked" && from && companyNumber) result = await sendWhatsApp({ to, text });
    if (result === "failed") throw new Error("WhatsApp gateway unreachable or rejected the message");
});
registerJob("email", async (payload) => { await sendEmail(payload); });
registerJob("push", async (payload) => { await sendPush(payload); });

/**
 * Who may get a WhatsApp from this person's own phone: up the chain and down to their own people.
 * A member reaches their department heads; a head reaches the admins and the departments they lead;
 * an admin reaches anyone (null). Everyone else on an alert hears from the company number, if any.
 */
const whatsappReach = async (sender) => {
    if (sender.role === "admin") return null;
    const ids = await departmentHeadsOf([sender._id]);
    const headed = headedDepartmentIds(sender);
    if (headed.length || sender.role === "head") {
        ids.push(...await departmentMemberIds(headed));
        ids.push(...(await User.find({ role: "admin" }).select("_id").lean()).map((admin) => admin._id));
    }
    return new Set(ids.map(String));
};

/**
 * The single dispatch point for every alert. For each recipient it:
 *   1. stores an in-app notification and pushes it live over SSE        (if they want it in-app)
 *   2. queues a WhatsApp / email / mobile push                          (per their preferences)
 * Duplicates and the actor themselves are filtered out.
 *
 * `type` is the stored kind; `event` (optional) is the preference key when one type covers several
 * (a "deadline" can be "due today" or "due tomorrow"). `actor` is the user whose action caused the alert;
 * omit it for system alerts like reminders.
 */
const notify = async ({ userIds, actor, type, title, message = "", task, event }) => {
    const actorId = actor && actor._id;
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))]
        .filter((id) => !actorId || id !== String(actorId));

    if (ids.length === 0) return [];

    const ev = eventFor(type, event);
    const users = await User.find({ _id: { $in: ids } }).select("name email phone pushTokens notificationPrefs").lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const inAppIds = ids.filter((id) => wants(byId.get(id), ev, "inApp"));
    const docs = inAppIds.length
        ? await Notification.insertMany(inAppIds.map((user) => ({ user, task, type, event: ev, title, message })))
        : [];

    // Carry the authoritative unread count on the frame - a client that derives it
    // by incrementing drifts whenever it misses or double-counts an event.
    // ponytail: one count per recipient per alert. Fold into the insert with an
    // aggregation if notification volume ever makes this hurt.
    await Promise.all(docs.map(async (doc) => {
        const unreadCount = await Notification.countDocuments({ user: doc.user, read: false });
        push(doc.user, {
            _id: doc._id,
            type: doc.type,
            title: doc.title,
            message: doc.message,
            task: doc.task,
            read: false,
            createdAt: doc.createdAt,
            unreadCount,
        });
    }));

    // Everything below is best-effort and off the request path: a missing phone, an unset SMTP host or a
    // dead gateway degrades reach, never delivery of the in-app alert that already landed.
    const link = task ? `${CLIENT_URL}/user/task-details/${task}` : CLIENT_URL;
    // WhatsApp goes from the actor's own linked phone where whatsappReach allows, else the company number.
    const sender = whatsappEnabled && actorId
        ? await User.findById(actorId).select("role memberships waPhone").lean()
        : null;
    const reach = sender?.waPhone ? await whatsappReach(sender) : undefined;
    const jobs = [];
    for (const user of users) {
        const from = reach !== undefined && (reach === null || reach.has(String(user._id))) ? String(sender._id) : null;
        if (whatsappEnabled && (from || companyNumber) && user.phone && wants(user, ev, "whatsapp")) {
            jobs.push(enqueue("whatsapp", {
                to: user.phone,
                from,
                text: `*${title}*\n\nHi ${user.name},\n${message}` + (link ? `\n\n${link}` : ""),
            }));
        }
        if (emailEnabled && user.email && wants(user, ev, "email")) {
            jobs.push(enqueue("email", {
                to: user.email,
                subject: title,
                text: `Hi ${user.name},\n\n${message}` + (link ? `\n\nOpen the task: ${link}` : ""),
            }));
        }
        if (user.pushTokens?.length && wants(user, ev, "push")) {
            jobs.push(enqueue("push", {
                userId: String(user._id), tokens: user.pushTokens, title, body: message,
                data: task ? { taskId: String(task) } : {},
            }));
        }
    }
    await Promise.all(jobs).catch((error) => console.error("Could not queue notification delivery:", error.message));

    return docs;
};

module.exports = { notify };
