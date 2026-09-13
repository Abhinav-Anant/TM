const Notification = require('../model/notification.model.js');
const User = require('../model/user.model.js');
const { push } = require('./sse.js');
const { sendMail, escapeHtml } = require('./mailer.js');

const CLIENT_URL = process.env.CLIENT_URL || "";

/**
 * Single dispatch point for every alert: stores an in-app notification,
 * pushes it over SSE and (when SMTP is configured) emails the recipient.
 * Duplicates and the actor themselves are filtered out.
 */
const notify = async ({ userIds, actorId, type, title, message = "", task, email = true }) => {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))]
        .filter((id) => !actorId || id !== String(actorId));

    if (ids.length === 0) return [];

    const docs = await Notification.insertMany(
        ids.map((user) => ({ user, task, type, title, message }))
    );

    docs.forEach((doc) => push(doc.user, {
        _id: doc._id,
        type: doc.type,
        title: doc.title,
        message: doc.message,
        task: doc.task,
        read: false,
        createdAt: doc.createdAt,
    }));

    if (email) {
        const users = await User.find({ _id: { $in: ids } }).select("email name");
        const link = task ? `${CLIENT_URL}/user/task-details/${task}` : CLIENT_URL;

        await Promise.all(users.map((user) => sendMail({
            to: user.email,
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
