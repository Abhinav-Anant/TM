const Task = require('../model/task.model.js');
const { OPEN } = require('./taskStatus.js');
const Notification = require('../model/notification.model.js');
const { notify } = require('./notify.js');
const { departmentHeadsOf } = require('./scope.js');
const { MINUTE: MS_PER_MINUTE } = require('./workTime.js');

const MINUTE = 60 * 1000;
const WINDOW_HOURS = Number(process.env.REMINDER_WINDOW_HOURS) || 24;
const INTERVAL_MINUTES = Number(process.env.REMINDER_INTERVAL_MINUTES) || 15;
const DAY = 24 * 60 * MINUTE;

const parseEscalateAfterDays = (raw) => {
    const trimmed = String(raw ?? "").trim();
    const parsed = Number(trimmed);
    return trimmed !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
};
const ESCALATE_AFTER_DAYS = parseEscalateAfterDays(process.env.ESCALATE_AFTER_DAYS);
// Bounds each scan to a window rather than "overdue by at least N days forever":
// stops the first scan after deploy from alerting on every long-abandoned task,
// and keeps each scan bounded.
const ESCALATION_WINDOW_DAYS = 7;

const formatDate = (date) => new Date(date).toDateString();

/** Finds open tasks that are due soon or already overdue and alerts their assignees once each. */
const scanDeadlines = async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + WINDOW_HOURS * 60 * MINUTE);

    const tasks = await Task.find({
        status: OPEN,
        dueDate: { $lte: soon },
    }).select("title dueDate assignedTo");

    let sentCount = 0;

    for (const task of tasks) {
        const overdue = task.dueDate < now;
        const type = overdue ? "overdue" : "deadline";

        // One alert of each kind per task per user - no repeat spam on every scan.
        const alreadyAlerted = new Set(
            (await Notification.find({ task: task._id, type }).distinct("user")).map(String)
        );
        const targets = (task.assignedTo || []).filter((id) => !alreadyAlerted.has(String(id)));
        if (targets.length === 0) continue;

        await notify({
            userIds: targets,
            type,
            task: task._id,
            title: overdue ? `Overdue: ${task.title}` : `Due soon: ${task.title}`,
            message: overdue
                ? `"${task.title}" was due on ${formatDate(task.dueDate)} and is still open.`
                : `"${task.title}" is due on ${formatDate(task.dueDate)}.`,
        });
        sentCount += targets.length;
    }

    return sentCount;
};

/**
 * Tasks still open ESCALATE_AFTER_DAYS past their due date go over the
 * assignees' heads: the department heads and the task's creator hear about it,
 * once each per task. The assignees already had their own overdue alert.
 */
const scanEscalations = async (now = new Date()) => {
    const cutoff = new Date(now.getTime() - ESCALATE_AFTER_DAYS * DAY);
    const windowStart = new Date(now.getTime() - (ESCALATE_AFTER_DAYS + ESCALATION_WINDOW_DAYS) * DAY);
    const tasks = await Task.find({ status: OPEN, dueDate: { $lt: cutoff, $gte: windowStart } })
        .select("title dueDate assignedTo createdBy");

    let sentCount = 0;

    for (const task of tasks) {
        const alreadyAlerted = new Set(
            (await Notification.find({ task: task._id, type: "escalation" }).distinct("user")).map(String)
        );
        const recipients = [...await departmentHeadsOf(task.assignedTo), ...(task.createdBy || [])].map(String);
        const targets = [...new Set(recipients)].filter((id) => !alreadyAlerted.has(id));
        if (targets.length === 0) continue;

        const days = Math.floor((now - task.dueDate) / DAY);
        await notify({
            userIds: targets,
            type: "escalation",
            task: task._id,
            title: `Escalation: ${task.title}`,
            message: `"${task.title}" is ${days} days overdue (due ${formatDate(task.dueDate)}) and still open.`,
        });
        sentCount += targets.length;
    }

    return sentCount;
};

/**
 * Per-task reminders ("1 hour before" etc). Safe with several app instances running:
 * each task is claimed with a conditional update, and only the instance that wins
 * the claim sends - everyone else sees modifiedCount 0 and skips it.
 */
const scanReminders = async (now = new Date()) => {
    const due = await Task.find({ remindAt: { $lte: now }, reminderSentAt: null, status: OPEN })
        .select("title dueDate assignedTo").limit(500);

    let sent = 0;
    for (const task of due) {
        const claim = await Task.updateOne({ _id: task._id, reminderSentAt: null }, { $set: { reminderSentAt: now } });
        if (!claim.modifiedCount) continue;

        const minutes = Math.round((task.dueDate - now) / MS_PER_MINUTE);
        const when = minutes > 0 ? `is due ${formatDate(task.dueDate)}` : "is due now";
        await notify({
            userIds: task.assignedTo,
            type: "deadline",
            task: task._id,
            title: `Reminder: ${task.title}`,
            message: `"${task.title}" ${when}.`,
        });
        sent += 1;
    }
    return sent;
};

// ponytail: in-process setInterval. Reminders are claim-guarded so extra instances cannot double-send;
// the deadline/escalation scans above still dedupe by notification lookup - move them to a queue in the jobs phase.
const startReminders = () => {
    const run = () => scanDeadlines()
        .then(() => scanEscalations())
        .then(() => scanReminders())
        .catch((err) => console.error("Reminder scan failed:", err.message));
    run();
    const timer = setInterval(run, INTERVAL_MINUTES * MINUTE);
    timer.unref?.();
    console.log(`Deadline reminders active (every ${INTERVAL_MINUTES}m, ${WINDOW_HOURS}h window)`);
    return timer;
};

module.exports = { startReminders, scanDeadlines, scanEscalations, scanReminders };
