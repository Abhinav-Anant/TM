/**
 * Appends one line to a task's timeline. Call before task.save(), so the entry
 * lands in the same write as the change it describes.
 * `type` is for icons/filtering; `text` is what the timeline shows after the actor's name.
 */
const logActivity = (task, user, type, text) => {
    task.activity.push({ user: user?._id, type, text });
};

/** Logs the right entry for a status transition (completed / reopened / review / plain change). */
const logStatusChange = (task, previous, user) => {
    if (previous === task.status) return;
    if (task.status === "Completed") return logActivity(task, user, "completed", "completed the task");
    if (previous === "Completed") return logActivity(task, user, "reopened", `reopened the task (${previous} → ${task.status})`);
    if (task.status === "In Review") return logActivity(task, user, "review", "submitted for review");
    logActivity(task, user, "status", `changed status: ${previous} → ${task.status}`);
};

module.exports = { logActivity, logStatusChange };
