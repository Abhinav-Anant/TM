const mongoose = require('mongoose');
const Task = require('../model/task.model.js');
const { notify } = require('../utils/notify.js');
const { scopeFor, canAccessTask } = require('../utils/scope.js');
const { logActivity } = require('../utils/activity.js');
const { createsCycle } = require('../utils/taskLinks.js');

const SUBTASK_STATUSES = ['To Do', 'In Progress', 'Completed'];

const fail = (res, error) => res.status(500).json({ message: "Server error", error: error.message });

/** Loads the task and checks the caller may touch it. Sends the 404/403 itself; returns null then. */
const loadAccessible = async (req, res) => {
    const task = mongoose.isValidObjectId(req.params.id) ? await Task.findById(req.params.id) : null;
    if (!task) { res.status(404).json({ message: "Task not found" }); return null; }
    if (!await canAccessTask(req.user, task)) { res.status(403).json({ message: "Not authorized" }); return null; }
    return task;
};

// ---- tags -------------------------------------------------------------------
const getTags = async (req, res) => {
    try {
        const tags = await Task.distinct("tags", await scopeFor(req.user));
        res.json({ tags: tags.filter(Boolean).sort() });
    } catch (error) { fail(res, error); }
};

// ---- watchers ---------------------------------------------------------------
// PUT /:id/watch { watching: true|false }
const setWatching = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        const me = String(req.user._id);
        const rest = task.watchers.filter((id) => String(id) !== me);
        task.watchers = req.body.watching === false ? rest : [...rest, req.user._id];
        await task.save();
        res.json({ isWatching: req.body.watching !== false, watchers: task.watchers.length });
    } catch (error) { fail(res, error); }
};

// ---- blocked by -------------------------------------------------------------
// PUT /:id/blocked-by { blockedBy: [taskId] } - replaces the list.
const setBlockedBy = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;

        if (!Array.isArray(req.body.blockedBy)) {
            return res.status(400).json({ message: "blockedBy must be an array of task ids" });
        }
        const ids = [...new Set(req.body.blockedBy.map(String))];
        if (ids.some((id) => !mongoose.isValidObjectId(id))) {
            return res.status(400).json({ message: "blockedBy must be an array of task ids" });
        }
        if (ids.includes(String(task._id))) {
            return res.status(400).json({ message: "A task cannot be blocked by itself" });
        }

        const blockers = await Task.find({ _id: { $in: ids } });
        if (blockers.length !== ids.length) return res.status(404).json({ message: "One of those tasks does not exist" });
        // Naming a task you cannot open would leak its title back in "Waiting for ...".
        for (const blocker of blockers) {
            if (!await canAccessTask(req.user, blocker)) return res.status(403).json({ message: "You cannot link to a task you cannot open" });
        }
        if (await createsCycle(task._id, ids)) {
            return res.status(400).json({ message: "That would create a loop: those tasks already wait on this one" });
        }

        const before = task.blockedBy.map(String);
        task.blockedBy = ids;
        const added = blockers.filter((b) => !before.includes(String(b._id)));
        if (added.length) logActivity(task, req.user, "blocked", `marked as blocked by ${added.map((b) => b.title).join(", ")}`);
        else if (ids.length < before.length) logActivity(task, req.user, "blocked", "changed what this task is blocked by");
        await task.save();

        await task.populate("blockedBy", "title status");
        const waiting = task.blockedBy.filter((t) => !["Completed", "Cancelled"].includes(t.status));
        if (added.length && waiting.length) {
            await notify({
                userIds: task.assignedTo,
                actor: req.user, type: "blocked", task: task._id,
                title: `Blocked: ${task.title}`,
                message: `${req.user.name} made "${task.title}" wait for ${waiting.map((t) => t.title).join(", ")}.`,
            });
        }
        res.json({
            blockedBy: task.blockedBy,
            waitingFor: task.blockedBy.filter((t) => !["Completed", "Cancelled"].includes(t.status)).map((t) => t.title),
        });
    } catch (error) { fail(res, error); }
};

// ---- subtasks ---------------------------------------------------------------
// An assignee must already be on the parent task: that is what lets them see it.
const checkAssignee = (task, assignee) => (
    !assignee || task.assignedTo.some((id) => String(id) === String(assignee))
);

const subtaskReply = async (task, res, status = 200) => {
    await task.populate("subtasks.assignee", "name email profileImageUrl");
    res.status(status).json({ subtasks: task.subtasks });
};

const addSubtask = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        const title = String(req.body.title || "").trim();
        if (!title) return res.status(400).json({ message: "Subtask title is required" });
        if (!checkAssignee(task, req.body.assignee)) {
            return res.status(400).json({ message: "Assign a subtask to someone already on the task" });
        }
        if (task.subtasks.length >= 50) return res.status(400).json({ message: "A task can have up to 50 subtasks" });

        task.subtasks.push({ title, assignee: req.body.assignee || null, dueDate: req.body.dueDate || null });
        logActivity(task, req.user, "subtask", `added subtask "${title}"`);
        await task.save();
        await notify({
            userIds: req.body.assignee ? [req.body.assignee] : [],
            actor: req.user, type: "assigned", task: task._id,
            title: `Subtask: ${title}`,
            message: `${req.user.name} gave you the subtask "${title}" on "${task.title}".`,
        });
        await subtaskReply(task, res, 201);
    } catch (error) { fail(res, error); }
};

const updateSubtask = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        const sub = task.subtasks.id(req.params.subId);
        if (!sub) return res.status(404).json({ message: "Subtask not found" });

        const { title, status, assignee, dueDate } = req.body;
        if (status !== undefined && !SUBTASK_STATUSES.includes(status)) {
            return res.status(400).json({ message: `status must be one of ${SUBTASK_STATUSES.join(", ")}` });
        }
        if (assignee !== undefined && !checkAssignee(task, assignee)) {
            return res.status(400).json({ message: "Assign a subtask to someone already on the task" });
        }
        if (title !== undefined) {
            if (!String(title).trim()) return res.status(400).json({ message: "Subtask title is required" });
            sub.title = String(title).trim();
        }
        if (assignee !== undefined) sub.assignee = assignee || null;
        if (dueDate !== undefined) sub.dueDate = dueDate || null;
        if (status !== undefined && status !== sub.status) {
            sub.status = status;
            logActivity(task, req.user, "subtask", `marked subtask "${sub.title}" ${status}`);
        }
        await task.save();
        await subtaskReply(task, res);
    } catch (error) { fail(res, error); }
};

const deleteSubtask = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        const sub = task.subtasks.id(req.params.subId);
        if (!sub) return res.status(404).json({ message: "Subtask not found" });
        logActivity(task, req.user, "subtask", `removed subtask "${sub.title}"`);
        sub.deleteOne();
        await task.save();
        await subtaskReply(task, res);
    } catch (error) { fail(res, error); }
};

module.exports = { getTags, setWatching, setBlockedBy, addSubtask, updateSubtask, deleteSubtask };
