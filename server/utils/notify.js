const Notification = require('../model/notification.model.js');
const User = require('../model/user.model.js');
const { push } = require('./sse.js');
const { sendWhatsApp } = require('./whatsapp.js');

const CLIENT_URL = process.env.CLIENT_URL || "";

// Must stay above the gateway's Safe Mode minimum gap (1s at its most permissive
// tier) or paced sends still get rejected. Set to 0 in tests to keep them quick.
const SEND_GAP_MS = Number(process.env.WHATSAPP_SEND_GAP_MS ?? 1200);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single dispatch point for every alert: stores an in-app notification,
 * pushes it over SSE and (when the WhatsApp gateway is configured) messages
 * the recipient. Duplicates and the actor themselves are filtered out.
 *
 * `actor` is the user whose action caused the alert (a full user doc, usually
 * `req.user`). Their name is already baked into `message` by the caller; this
 * is what keeps them from being notified about their own action. Omit it for
 * system-generated alerts like deadline reminders.
 */
const notify = async ({ userIds, actor, type, title, message = "", task }) => {
    const actorId = actor && actor._id;
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))]
        .filter((id) => !actorId || id !== String(actorId));

    if (ids.length === 0) return [];

    const docs = await Notification.insertMany(
        ids.map((user) => ({ user, task, type, title, message }))
    );

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

    // Only people who saved a number get a message; everyone else still has the
    // in-app alert, so a missing number degrades reach, never delivery.
    const recipients = await User.find({ _id: { $in: ids }, phone: { $ne: null } }).select("phone name");
    const link = task ? `${CLIENT_URL}/user/task-details/${task}` : CLIENT_URL;

    // Sequential, with a gap, and deliberately not awaited.
    //
    // The gateway's Safe Mode enforces a minimum gap between sends and REJECTS
    // anything faster rather than queuing it. A completion notifies the assignees,
    // their department head and every admin at once, so a concurrent Promise.all
    // would get the first message through and lose the rest.
    //
    // Not awaited because the in-app notification and the SSE push - everything
    // the UI needs - have already landed by this point. Pacing half a dozen
    // messages would otherwise hold the HTTP response open for several seconds.
    // sendWhatsApp never throws, so nothing here can reject.
    void (async () => {
        for (const user of recipients) {
            await sendWhatsApp({
                to: user.phone,
                text: `*${title}*\n\nHi ${user.name},\n${message}` + (link ? `\n\n${link}` : ""),
            });
            if (SEND_GAP_MS > 0) await sleep(SEND_GAP_MS);
        }
    })();

    return docs;
};

module.exports = { notify };
