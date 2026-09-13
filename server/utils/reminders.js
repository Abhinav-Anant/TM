const Task = require('../model/task.model.js');
const Notification = require('../model/notification.model.js');
const { notify } = require('./notify.js');

const MINUTE = 60 * 1000;
const WINDOW_HOURS = Number(process.env.REMINDER_WINDOW_HOURS) || 24;
const INTERVAL_MINUTES = Number(process.env.REMINDER_INTERVAL_MINUTES) || 15;

const formatDate = (date) => new Date(date).toDateString();

/** Finds open tasks that are due soon or already overdue and alerts their assignees once each. */
const scanDeadlines = async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + WINDOW_HOURS * 60 * MINUTE);

    const tasks = await Task.find({
        status: { $ne: "Completed" },
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

// ponytail: in-process setInterval. Move to a real scheduler (cron/queue) if you run multiple instances.
const startReminders = () => {
    const run = () => scanDeadlines().catch((err) => console.error("Reminder scan failed:", err.message));
    run();
    const timer = setInterval(run, INTERVAL_MINUTES * MINUTE);
    timer.unref?.();
    console.log(`Deadline reminders active (every ${INTERVAL_MINUTES}m, ${WINDOW_HOURS}h window)`);
    return timer;
};

module.exports = { startReminders, scanDeadlines };
