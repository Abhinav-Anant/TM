const Notification = require('../model/notification.model.js');
const User = require('../model/user.model.js');
const { push } = require('./sse.js');
const { sendMail, escapeHtml } = require('./mailer.js');

const CLIENT_URL = process.env.CLIENT_URL || "";

/**
 * Single dispatch point for every alert: stores an in-app notification,
 * pushes it over SSE and (when SMTP is configured) emails the recipient.
 * Duplicates and the actor themselves are filtered out.
 *
 * `actor` is the user whose action caused the alert (a full user doc, usually
 * `req.user`). Passing it makes the mail read as being from them - assigner to
 * assignee, member back to whoever assigned it. Omit it for system-generated
 * alerts like deadline reminders, which then send under the plain app identity.
 */
const notify = async ({ userIds, actor, type, title, message = "", task, email = true }) => {
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

    if (email) {
        const users = await User.find({ _id: { $in: ids } }).select("email name");
        const link = task ? `${CLIENT_URL}/user/task-details/${task}` : CLIENT_URL;
        const fromName = actor && actor.name ? `${actor.name} (Task Manager)` : undefined;

        await Promise.all(users.map((user) => sendMail({
            to: user.email,
            replyTo: actor && actor.email ? actor.email : undefined,
            fromName,
            subject: title,
            text: `Hi ${user.name},\n\n${message}\n\n${link}`,
            html: `<p>Hi ${escapeHtml(user.name)},</p>`
                + `<p>${escapeHtml(message)}</p>`
                + (link ? `<p><a href="${escapeHtml(link)}">Open in Task Manager</a></p>` : ""),
        })));
    }

    return docs;
};

module.exports = { notify };
