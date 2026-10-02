const mongoose = require('mongoose');
const Task = require('../model/task.model.js');
const User = require('../model/user.model.js');
const { OPEN } = require('../utils/taskStatus.js');
const { scopeFor, canAccessTask, departmentMemberIds, headedDepartmentIds } = require('../utils/scope.js');
const { logActivity } = require('../utils/activity.js');
const { dayBounds, MINUTE } = require('../utils/workTime.js');

const fail = (res, error) => res.status(500).json({ message: "Server error", error: error.message });

const tzOffsetOf = (req) => parseInt(req.query.tzOffset, 10) || 0;

const formatMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

// ---- dashboards -------------------------------------------------------------
/**
 * Headline numbers for a set of tasks. "Overdue" means due before today (a task due
 * today is Due Today, not overdue), matching how the cards on screen are drawn.
 */
const headlineCounts = async (scope, bounds) => {
    const { start, end, weekStart } = bounds;
    const [open, overdue, dueToday, inProgress, upcoming, blocked, inReview, completedThisWeek] = await Promise.all([
        Task.countDocuments({ ...scope, status: OPEN }),
        Task.countDocuments({ ...scope, status: OPEN, dueDate: { $lt: start } }),
        Task.countDocuments({ ...scope, status: OPEN, dueDate: { $gte: start, $lt: end } }),
        Task.countDocuments({ ...scope, status: "In Progress" }),
        Task.countDocuments({ ...scope, status: OPEN, dueDate: { $gte: end } }),
        Task.countDocuments({ ...scope, status: "Blocked" }),
        Task.countDocuments({ ...scope, status: "In Review" }),
        Task.countDocuments({ ...scope, status: "Completed", completedAt: { $gte: weekStart } }),
    ]);
    return { open, overdue, dueToday, inProgress, upcoming, blocked, inReview, completedThisWeek };
};

// GET /api/tasks/my-dashboard - the signed-in person's own work.
const getMyDashboard = async (req, res) => {
    try {
        const counts = await headlineCounts({ assignedTo: req.user._id }, dayBounds(tzOffsetOf(req)));
        res.json(counts);
    } catch (error) { fail(res, error); }
};

// GET /api/tasks/manager-dashboard - admin: everyone; head: their department. Route-gated.
const getManagerDashboard = async (req, res) => {
    try {
        const bounds = dayBounds(tzOffsetOf(req));
        const scope = await scopeFor(req.user);
        const led = headedDepartmentIds(req.user);
        const userFilter = req.user.role === "admin" ? {} : { _id: { $in: await departmentMemberIds(led) } };

        const [totals, perUser, users] = await Promise.all([
            headlineCounts(scope, bounds),
            Task.aggregate([
                { $match: { ...scope, status: OPEN } },
                { $unwind: "$assignedTo" },
                { $group: {
                    _id: "$assignedTo",
                    open: { $sum: 1 },
                    overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", bounds.start] }] }, 1, 0] } },
                } },
            ]),
            User.find(userFilter).select("name email profileImageUrl role").limit(200).lean(),
        ]);

        const numbers = new Map(perUser.map((r) => [String(r._id), r]));
        const employees = users
            .map((u) => ({ ...u, open: numbers.get(String(u._id))?.open || 0, overdue: numbers.get(String(u._id))?.overdue || 0 }))
            .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));

        res.json({ totals, employees });
    } catch (error) { fail(res, error); }
};

// ---- simple time tracking -----------------------------------------------------
const MAX_MINUTES = 60 * 24 * 365;
const validMinutes = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= MAX_MINUTES);

const loadAccessible = async (req, res) => {
    const task = mongoose.isValidObjectId(req.params.id) ? await Task.findById(req.params.id) : null;
    if (!task) { res.status(404).json({ message: "Task not found" }); return null; }
    if (!await canAccessTask(req.user, task)) { res.status(403).json({ message: "Not authorized" }); return null; }
    return task;
};

const timeReply = (task) => ({
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    timerStartedAt: task.timerStartedAt,
    timerBy: task.timerBy,
});

// PUT /api/tasks/:id/time { estimatedMinutes?, actualMinutes? } - null clears the estimate.
const setTime = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        const { estimatedMinutes, actualMinutes } = req.body;
        for (const [name, value] of [["estimatedMinutes", estimatedMinutes], ["actualMinutes", actualMinutes]]) {
            if (value !== undefined && !validMinutes(value)) {
                return res.status(400).json({ message: `${name} must be a whole number of minutes (0 or more)` });
            }
        }
        if (actualMinutes === null) return res.status(400).json({ message: "actualMinutes cannot be cleared; set 0" });

        if (estimatedMinutes !== undefined && estimatedMinutes !== task.estimatedMinutes) {
            task.estimatedMinutes = estimatedMinutes;
            logActivity(task, req.user, "time", estimatedMinutes === null ? "removed the estimate" : `estimated ${formatMinutes(estimatedMinutes)}`);
        }
        if (actualMinutes !== undefined && actualMinutes !== task.actualMinutes) {
            task.actualMinutes = actualMinutes;
            logActivity(task, req.user, "time", `set time spent to ${formatMinutes(actualMinutes)}`);
        }
        await task.save();
        res.json(timeReply(task));
    } catch (error) { fail(res, error); }
};

// POST /api/tasks/:id/timer/start - one running timer per person, one per task.
const startTimer = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        if (task.timerStartedAt) return res.status(409).json({ message: "A timer is already running on this task" });
        const other = await Task.findOne({ timerBy: req.user._id }).select("title");
        if (other) return res.status(409).json({ message: `You already have a timer running on "${other.title}"` });

        // Claim atomically so two clicks (or two tabs) cannot both start it.
        const claim = await Task.updateOne({ _id: task._id, timerStartedAt: null }, { $set: { timerStartedAt: new Date(), timerBy: req.user._id } });
        if (!claim.modifiedCount) return res.status(409).json({ message: "A timer is already running on this task" });

        const fresh = await Task.findById(task._id);
        logActivity(fresh, req.user, "time", "started the timer");
        await fresh.save();
        res.json(timeReply(fresh));
    } catch (error) { fail(res, error); }
};

const MAX_TIMER_MINUTES = 24 * 60; // a forgotten timer must not log a week of work

// POST /api/tasks/:id/timer/stop - adds the elapsed time to actualMinutes.
const stopTimer = async (req, res) => {
    try {
        const task = await loadAccessible(req, res);
        if (!task) return;
        if (!task.timerStartedAt) return res.status(409).json({ message: "No timer is running on this task" });
        if (String(task.timerBy) !== String(req.user._id) && req.user.role !== "admin") {
            return res.status(403).json({ message: "Only the person who started the timer can stop it" });
        }

        const minutes = Math.min(MAX_TIMER_MINUTES, Math.max(1, Math.round((Date.now() - task.timerStartedAt.getTime()) / MINUTE)));
        const startedAt = task.timerStartedAt;
        // Same claim trick: only one stop request gets to add the time.
        const claim = await Task.updateOne(
            { _id: task._id, timerStartedAt: startedAt },
            { $set: { timerStartedAt: null, timerBy: null }, $inc: { actualMinutes: minutes } },
        );
        if (!claim.modifiedCount) return res.status(409).json({ message: "No timer is running on this task" });

        const fresh = await Task.findById(task._id);
        logActivity(fresh, req.user, "time", `stopped the timer (+${formatMinutes(minutes)})`);
        await fresh.save();
        res.json(timeReply(fresh));
    } catch (error) { fail(res, error); }
};

module.exports = { getMyDashboard, getManagerDashboard, setTime, startTimer, stopTimer, headlineCounts };
