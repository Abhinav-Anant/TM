const mongoose = require('mongoose');
const Task = require('../model/task.model.js');
const User = require('../model/user.model.js');
const { notify } = require('../utils/notify.js');
const { scopeFor, canAccessTask, canAssignTo, canReview, departmentHeadsOf, departmentMemberIds, headedDepartmentIds } = require('../utils/scope.js');
const { RECURRENCES, nextDueDate } = require('../utils/recurrence.js');

const SORTABLE_FIELDS = ["dueDate", "createdAt", "updatedAt", "priority", "progress", "title"];
const PRIORITY_ORDER = { High: 3, Medium: 2, Low: 1 };

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Builds the Mongo filter from the query string.
 * Takes an already-resolved `scope` (from utils/scope.js) rather than the user, so
 * this stays a pure, synchronous function - resolving a head's department members
 * needs a database round trip and belongs at the call site.
 * Returns `base` (everything except status) so the status tab counts stay
 * consistent with the other active filters.
 */
const buildFilters = (scope, query) => {
    const { status, priority, category, search, dueBefore, dueAfter, overdue } = query;
    const base = { ...scope };

    if (priority && priority.trim()) base.priority = priority.trim();
    if (category && category.trim()) base.category = category.trim();

    if ((dueBefore && dueBefore.trim()) || (dueAfter && dueAfter.trim())) {
        base.dueDate = {};
        if (dueAfter && dueAfter.trim()) base.dueDate.$gte = new Date(dueAfter);
        if (dueBefore && dueBefore.trim()) base.dueDate.$lte = new Date(dueBefore);
    }

    if (overdue === "true") {
        base.dueDate = { ...(base.dueDate || {}), $lt: new Date() };
        base.status = { $ne: "Completed" };
    }

    if (search && search.trim()) {
        const rx = new RegExp(escapeRegex(search.trim()), "i");
        base.$or = [{ title: rx }, { description: rx }];
    }

    const filter = { ...base };
    if (status && status.trim() && status !== "All") {
        const wanted = status.trim();
        // The base filter may already exclude this status (overdue implies "not Completed").
        // Asking for it anyway must return nothing, not silently drop the exclusion.
        filter.status = base.status?.$ne === wanted ? { $in: [] } : wanted;
    }

    return { base, filter };
};

const buildSort = (query) => {
    const field = SORTABLE_FIELDS.includes(query.sortBy) ? query.sortBy : "createdAt";
    const order = query.sortOrder === "asc" ? 1 : -1;
    return { [field]: order };
};

const withCompletedCount = (task) => {
    const doc = typeof task.toObject === "function" ? task.toObject() : task;
    return {
        ...doc,
        completedTodoCount: (doc.todoChecklist || []).filter((item) => item.completed).length,
    };
};

/** Everyone who should hear about a change to this task. */
const watchersOf = (task) => [...(task.assignedTo || []), ...(task.createdBy || [])];

/**
 * Completion is the one event that escalates past the people directly on the task:
 * the assignees' department heads and every admin are copied too, so a head hears
 * about their own department's work even on a task an admin created and assigned.
 * notify() de-duplicates and drops the actor, so overlap with watchersOf is free.
 */
const completionWatchers = async (task) => {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    return [
        ...watchersOf(task),
        ...admins.map((admin) => admin._id),
        ...await departmentHeadsOf(task.assignedTo),
    ];
};

// What a client may ask for. In Review is the server's answer to "Completed"
// on a task that needs sign-off, never a request.
const REQUESTABLE_STATUSES = ["Pending", "In Progress", "Completed"];

/** Whoever can sign off this task: its creator and the assignees' heads. */
const reviewersOf = async (task) => [
    ...(task.createdBy || []),
    ...await departmentHeadsOf(task.assignedTo),
];

/** Ticks everything and stamps completion. Every path into Completed goes through here. */
const markCompleted = (task) => {
    task.todoChecklist.forEach((item) => { item.completed = true; });
    task.progress = 100;
    task.status = "Completed";
    task.completedAt = task.completedAt || new Date();
};

/**
 * Creates the next copy of a recurring task, at most once per task.
 * The conditional update claims the slot before the copy exists, so two
 * completions racing each other cannot both spawn.
 */
const spawnNext = async (task) => {
    if (!task.recurrence || task.recurrence === "none" || task.nextTask) return null;

    const nextId = new mongoose.Types.ObjectId();
    const claim = await Task.updateOne({ _id: task._id, nextTask: null }, { $set: { nextTask: nextId } });
    if (!claim.modifiedCount) return null;
    task.nextTask = nextId;

    const next = await Task.create({
        _id: nextId,
        title: task.title,
        description: task.description,
        category: task.category,
        priority: task.priority,
        dueDate: nextDueDate(task.dueDate, task.recurrence),
        assignedTo: task.assignedTo,
        createdBy: task.createdBy,
        attachments: task.attachments,
        todoChecklist: task.todoChecklist.map((item) => ({ text: item.text, completed: false })),
        requiresReview: task.requiresReview,
        recurrence: task.recurrence,
        lead: task.lead,
    });

    // No actor: the person who completed the last one still needs to hear about the next.
    await notify({
        userIds: next.assignedTo,
        type: "assigned",
        task: next._id,
        title: `New task: ${next.title}`,
        message: `"${next.title}" repeats ${next.recurrence}; the next one is due ${new Date(next.dueDate).toDateString()}.`,
    });
    return next;
};

/** Alerts (and the recurring spawn) for a status transition that has already been saved. */
const afterStatusChange = async (task, previousStatus, actor) => {
    if (previousStatus === task.status) return;

    if (task.status === "Completed") {
        await notify({
            userIds: await completionWatchers(task),
            actor,
            type: "status",
            task: task._id,
            title: `${task.title} is now Completed`,
            message: `${actor.name} moved "${task.title}" from ${previousStatus} to Completed.`,
        });
        await spawnNext(task);
    } else if (task.status === "In Review") {
        await notify({
            userIds: await reviewersOf(task),
            actor,
            type: "review",
            task: task._id,
            title: `Review: ${task.title}`,
            message: `${actor.name} finished "${task.title}" and it is waiting for your approval.`,
        });
    } else {
        await notify({
            userIds: watchersOf(task),
            actor,
            type: "status",
            task: task._id,
            title: `${task.title} is now ${task.status}`,
            message: `${actor.name} moved "${task.title}" from ${previousStatus} to ${task.status}.`,
        });
    }
};

const populateTask = (id) => Task.findById(id)
    .populate("assignedTo", "name email profileImageUrl")
    .populate("comments.user", "name email profileImageUrl");

const getDashboardData = async (req, res) => {
    try {
        if (!["admin", "head"].includes(req.user.role)) {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        // Every figure on this dashboard is scoped: a head sees their own
        // department's numbers only, never an org-wide total.
        const scope = await scopeFor(req.user);
        const led = headedDepartmentIds(req.user);
        const memberIds = led.length ? await departmentMemberIds(led) : null;
        const userFilter = memberIds ? { _id: { $in: memberIds } } : {};

        const [
            allTasksCount,
            pendingTasksCount,
            inProgressTasksCount,
            inReviewTasksCount,
            completedTasksCount,
            overdueTasksCount,
            allUsersCount,
            assignedUserIds,
        ] = await Promise.all([
            Task.countDocuments(scope),
            Task.countDocuments({ ...scope, status: 'Pending' }),
            Task.countDocuments({ ...scope, status: 'In Progress' }),
            Task.countDocuments({ ...scope, status: 'In Review' }),
            Task.countDocuments({ ...scope, status: 'Completed' }),
            Task.countDocuments({ ...scope, status: { $ne: 'Completed' }, dueDate: { $lt: new Date() } }),
            User.countDocuments(userFilter),
            Task.distinct("assignedTo", scope),
        ]);

        res.status(200).json({
            message: "Dashboard data retrieved successfully",
            data: {
                allTasksCount,
                pendingTasksCount,
                inProgressTasksCount,
                inReviewTasksCount,
                completedTasksCount,
                overdueTasksCount,
                allUsersCount,
                usersWithTasksCount: assignedUserIds.length,
                tasksPerUserAvg: allUsersCount ? allTasksCount / allUsersCount : 0,
            },
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getUserDashboardData = async (req, res) => {
    try {
        const assignedTasks = await Task.find({ assignedTo: req.user._id })
            .sort({ dueDate: 1 })
            .populate("assignedTo", "name email profileImageUrl");

        const statusSummary = { Pending: 0, InProgress: 0, InReview: 0, Completed: 0 };
        const prioritySummary = { Low: 0, Medium: 0, High: 0 };

        assignedTasks.forEach((task) => {
            if (task.status === "Pending") statusSummary.Pending += 1;
            else if (task.status === "In Progress") statusSummary.InProgress += 1;
            else if (task.status === "In Review") statusSummary.InReview += 1;
            else if (task.status === "Completed") statusSummary.Completed += 1;

            if (prioritySummary[task.priority] !== undefined) prioritySummary[task.priority] += 1;
        });

        const now = new Date();
        const overdueTasks = assignedTasks.filter(
            (task) => task.status !== "Completed" && task.dueDate < now
        ).length;

        return res.json({
            message: "User dashboard data retrieved successfully",
            data: {
                charts: {
                    taskDistribution: { All: assignedTasks.length, ...statusSummary },
                    taskPriorityLevels: prioritySummary,
                },
                overdueTasks,
                recentTasks: assignedTasks.map(withCompletedCount).slice(0, 10),
            },
        });
    } catch (error) {
        console.error("Error in getUserDashboardData:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get all tasks (Admin: all, User: only assigned) with search, filtering and sorting.
const getTasks = async (req, res) => {
    try {
        const { base, filter } = buildFilters(await scopeFor(req.user), req.query);

        let tasks = await Task.find(filter)
            .sort(buildSort(req.query))
            .populate("assignedTo", "name email profileImageUrl");

        // Mongo would sort the Low/Medium/High enum alphabetically - order it properly here.
        if (req.query.sortBy === "priority") {
            const dir = req.query.sortOrder === "asc" ? -1 : 1;
            tasks = tasks.sort((a, b) => dir * (PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]));
        }

        // Setting `status` per tab would overwrite a status the base filter excludes
        // (overdue implies "not Completed"), so honour that exclusion instead of counting it.
        const countByStatus = (status) => (
            base.status?.$ne === status ? Promise.resolve(0) : Task.countDocuments({ ...base, status })
        );

        const [allTasks, pendingTasks, inProgressTasks, inReviewTasks, completedTasks] = await Promise.all([
            Task.countDocuments(base),
            countByStatus("Pending"),
            countByStatus("In Progress"),
            countByStatus("In Review"),
            countByStatus("Completed"),
        ]);

        res.json({
            tasks: tasks.map(withCompletedCount),
            statusSummary: { all: allTasks, pendingTasks, inProgressTasks, inReviewTasks, completedTasks },
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getCategories = async (req, res) => {
    try {
        const categories = await Task.distinct("category", await scopeFor(req.user));
        res.json({ categories: categories.filter(Boolean).sort() });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getAnalytics = async (req, res) => {
    try {
        const scope = await scopeFor(req.user);
        const days = Math.min(Number(req.query.days) || 30, 180);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const now = new Date();

        const groupCount = (field) => Task.aggregate([
            { $match: scope },
            { $group: { _id: `$${field}`, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]);

        const [
            statusGroups,
            priorityGroups,
            categoryGroups,
            trendCreated,
            trendCompleted,
            progressAgg,
            overdueCount,
            upcoming,
        ] = await Promise.all([
            groupCount("status"),
            groupCount("priority"),
            Task.aggregate([
                { $match: scope },
                {
                    $group: {
                        _id: { $ifNull: ["$category", "General"] },
                        count: { $sum: 1 },
                        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
                        avgProgress: { $avg: "$progress" },
                    },
                },
                { $sort: { count: -1 } },
            ]),
            Task.aggregate([
                { $match: { ...scope, createdAt: { $gte: since } } },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
            ]),
            Task.aggregate([
                { $match: { ...scope, completedAt: { $gte: since } } },
                { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } }, count: { $sum: 1 } } },
            ]),
            Task.aggregate([{ $match: scope }, { $group: { _id: null, avgProgress: { $avg: "$progress" } } }]),
            Task.countDocuments({ ...scope, status: { $ne: "Completed" }, dueDate: { $lt: now } }),
            Task.find({ ...scope, status: { $ne: "Completed" }, dueDate: { $gte: now } })
                .sort({ dueDate: 1 })
                .limit(5)
                .select("title dueDate priority status category progress"),
        ]);

        const byStatus = statusGroups.map((g) => ({ status: g._id, count: g.count }));
        const total = byStatus.reduce((sum, g) => sum + g.count, 0);
        const completed = byStatus.find((g) => g.status === "Completed")?.count || 0;

        // Merge both trend aggregations onto one continuous day axis so gaps render as zero.
        const createdMap = Object.fromEntries(trendCreated.map((d) => [d._id, d.count]));
        const completedMap = Object.fromEntries(trendCompleted.map((d) => [d._id, d.count]));
        const trend = [];
        for (let i = days - 1; i >= 0; i -= 1) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            trend.push({ date, created: createdMap[date] || 0, completed: completedMap[date] || 0 });
        }

        res.json({
            totals: {
                all: total,
                completed,
                overdue: overdueCount,
                completionRate: total ? Math.round((completed / total) * 100) : 0,
                avgProgress: Math.round(progressAgg[0]?.avgProgress || 0),
            },
            byStatus,
            byPriority: priorityGroups.map((g) => ({ priority: g._id, count: g.count })),
            byCategory: categoryGroups.map((g) => ({
                category: g._id,
                count: g.count,
                completed: g.completed,
                avgProgress: Math.round(g.avgProgress || 0),
            })),
            trend,
            upcoming,
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getTaskById = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id)
            .populate("assignedTo", "name email profileImageUrl")
            .populate("comments.user", "name email profileImageUrl");

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Members may only open tasks assigned to them, heads only tasks within
        // their department - a task id is guessable and the document carries
        // descriptions, attachments and comments.
        if (!await canAccessTask(req.user, task)) {
            return res.status(403).json({ message: "Not authorized to view this task" });
        }

        // The client shows Approve / Send back from this; the /review route re-checks.
        res.json({ ...task.toObject(), canReview: await canReview(req.user, task) });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const createTask = async (req, res) => {
    try {
        const {
            title, description, priority, category,
            dueDate, assignedTo, attachments, todoChecklist,
            requiresReview, recurrence,
        } = req.body;

        if (!Array.isArray(assignedTo)) {
            return res.status(400).json({ message: "assigned-to must be an array of user ID's" });
        }

        if (recurrence !== undefined && !RECURRENCES.includes(recurrence)) {
            return res.status(400).json({ message: `recurrence must be one of ${RECURRENCES.join(", ")}` });
        }

        // Admins assign to anyone; a head only to their own department.
        if (!await canAssignTo(req.user, assignedTo)) {
            return res.status(403).json({ message: "You can only assign tasks to members of your own department" });
        }

        const task = await Task.create({
            title, description, priority,
            category: category || "General",
            dueDate, assignedTo,
            createdBy: req.user._id,
            attachments,
            todoChecklist,
            requiresReview: Boolean(requiresReview),
            recurrence: recurrence || "none",
        });

        await notify({
            userIds: assignedTo,
            actor: req.user,
            type: "assigned",
            task: task._id,
            title: `New task: ${task.title}`,
            message: `${req.user.name} assigned you "${task.title}", due ${new Date(task.dueDate).toDateString()}.`,
        });

        res.status(201).json({ message: "Task created successfully", task });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const updateTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        // The route already limits this to admin/head; a head must additionally
        // be limited to tasks inside their own department. Without this any
        // signed-in user could previously edit or reassign any task by id.
        if (!await canAccessTask(req.user, task)) {
            return res.status(403).json({ message: "Not authorized to update this task" });
        }

        const previousAssignees = (task.assignedTo || []).map(String);

        task.title = req.body.title || task.title;
        task.description = req.body.description || task.description;
        task.priority = req.body.priority || task.priority;
        task.category = req.body.category || task.category;
        task.dueDate = req.body.dueDate || task.dueDate;
        task.todoChecklist = req.body.todoChecklist || task.todoChecklist;
        task.attachments = req.body.attachments || task.attachments;

        if (typeof req.body.requiresReview === "boolean") task.requiresReview = req.body.requiresReview;
        if (req.body.recurrence !== undefined) {
            if (!RECURRENCES.includes(req.body.recurrence)) {
                return res.status(400).json({ message: `recurrence must be one of ${RECURRENCES.join(", ")}` });
            }
            task.recurrence = req.body.recurrence;
        }

        if (req.body.assignedTo) {
            if (!Array.isArray(req.body.assignedTo)) {
                return res.status(400).json({ message: "assigned-to must be an array of user ID's" });
            }
            // Reassignment must not be a way out of your own department.
            if (!await canAssignTo(req.user, req.body.assignedTo)) {
                return res.status(403).json({ message: "You can only assign tasks to members of your own department" });
            }
            task.assignedTo = req.body.assignedTo;
        }

        const updatedTask = await task.save();

        const currentAssignees = (updatedTask.assignedTo || []).map(String);

        await notify({
            userIds: currentAssignees.filter((id) => !previousAssignees.includes(id)),
            actor: req.user,
            type: "assigned",
            task: task._id,
            title: `New task: ${task.title}`,
            message: `${req.user.name} assigned you "${task.title}", due ${new Date(task.dueDate).toDateString()}.`,
        });

        await notify({
            userIds: currentAssignees.filter((id) => previousAssignees.includes(id)),
            actor: req.user,
            type: "updated",
            task: task._id,
            title: `Task updated: ${task.title}`,
            message: `${req.user.name} updated "${task.title}".`,
        });

        res.json({ message: "Task updated successfully", updatedTask });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

/** Recomputes progress + status from the checklist. A finished task that needs sign-off stops at In Review. */
const syncProgress = (task, { needsReview = false } = {}) => {
    const total = task.todoChecklist.length;
    const done = task.todoChecklist.filter((item) => item.completed).length;
    task.progress = total > 0 ? Math.round((done / total) * 100) : 0;

    if (total > 0 && task.progress === 100) task.status = needsReview ? "In Review" : "Completed";
    else if (task.progress > 0) task.status = "In Progress";
    else task.status = "Pending";

    task.completedAt = task.status === "Completed" ? (task.completedAt || new Date()) : null;
};

const updateTaskCheckList = async (req, res) => {
    try {
        const { todoChecklist } = req.body;
        const task = await Task.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        if (!await canAccessTask(req.user, task)) {
            return res.status(403).json({ message: "Not authorized to update checklist" });
        }

        const previousStatus = task.status;
        task.todoChecklist = todoChecklist;
        syncProgress(task, { needsReview: task.requiresReview && !await canReview(req.user, task) });
        await task.save();

        // Ticking boxes is routine; only finishing (or submitting for review) is news.
        if (["Completed", "In Review"].includes(task.status)) {
            await afterStatusChange(task, previousStatus, req.user);
        }

        const updatedTask = await populateTask(req.params.id);

        res.json({ message: "Task checklist updated", task: updatedTask });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const updateTaskStatus = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        if (!await canAccessTask(req.user, task)) {
            return res.status(403).json({ message: "Not Authorized" });
        }

        const wanted = req.body.status;
        if (!REQUESTABLE_STATUSES.includes(wanted)) {
            return res.status(400).json({ message: `status must be one of ${REQUESTABLE_STATUSES.join(", ")}` });
        }

        const previousStatus = task.status;

        if (wanted === "Completed") {
            markCompleted(task);
            if (task.requiresReview && !await canReview(req.user, task)) {
                task.status = "In Review";
                task.completedAt = null;
            }
        } else {
            task.status = wanted;
            const total = task.todoChecklist.length;
            const done = task.todoChecklist.filter((item) => item.completed).length;
            task.progress = total ? Math.round((done / total) * 100) : 0;
            task.completedAt = null;
        }

        const updatedTask = await task.save();
        await afterStatusChange(task, previousStatus, req.user);

        res.json({ message: "Task status updated successfully", updatedTask });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

/** Approve or send back a task waiting in review. */
const reviewTask = async (req, res) => {
    try {
        const { action } = req.body;
        if (!["approve", "reject"].includes(action)) {
            return res.status(400).json({ message: "action must be approve or reject" });
        }

        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        if (!await canReview(req.user, task)) {
            return res.status(403).json({ message: "Not authorized to review this task" });
        }
        if (task.status !== "In Review") {
            return res.status(400).json({ message: "This task is not waiting for review" });
        }

        if (action === "approve") {
            markCompleted(task);
            await task.save();
            await afterStatusChange(task, "In Review", req.user);
        } else {
            const note = String(req.body.note || "").trim().slice(0, 2000);
            task.status = "In Progress";
            task.completedAt = null;
            if (note) task.comments.push({ user: req.user._id, text: note });
            await task.save();

            await notify({
                userIds: task.assignedTo,
                actor: req.user,
                type: "review",
                task: task._id,
                title: `Sent back: ${task.title}`,
                message: `${req.user.name} sent "${task.title}" back` + (note ? `: ${note}` : "."),
            });
        }

        res.json({
            message: action === "approve" ? "Task approved" : "Task sent back",
            task: await populateTask(task._id),
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const addComment = async (req, res) => {
    try {
        const text = (req.body.text || "").trim();
        if (!text) {
            return res.status(400).json({ message: "Comment text is required" });
        }

        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        if (!await canAccessTask(req.user, task)) {
            return res.status(403).json({ message: "Not authorized to comment on this task" });
        }

        task.comments.push({ user: req.user._id, text });
        await task.save();

        await notify({
            userIds: watchersOf(task),
            actor: req.user,
            type: "comment",
            task: task._id,
            title: `New comment on ${task.title}`,
            message: `${req.user.name}: ${text.slice(0, 140)}`,
        });

        await task.populate("comments.user", "name email profileImageUrl");
        res.status(201).json({ message: "Comment added", comments: task.comments });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const deleteComment = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const comment = task.comments.id(req.params.commentId);
        if (!comment) {
            return res.status(404).json({ message: "Comment not found" });
        }

        // Only the author or an admin may remove a comment.
        if (comment.user.toString() !== req.user._id.toString() && req.user.role !== "admin") {
            return res.status(403).json({ message: "Not authorized to delete this comment" });
        }

        comment.deleteOne();
        await task.save();
        await task.populate("comments.user", "name email profileImageUrl");

        res.json({ message: "Comment deleted", comments: task.comments });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Turns uploaded files into public URLs the client appends to task.attachments.
const uploadAttachments = (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "No files uploaded" });
    }

    const files = req.files.map((file) => ({
        name: file.originalname,
        size: file.size,
        url: `${req.protocol}://${req.get("host")}/uploads/${file.filename}`,
    }));

    res.status(200).json({ files, urls: files.map((f) => f.url) });
};

const deleteTask = async (req, res) => {
    try {
        const task = await Task.findById(req.params.id);

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        await task.deleteOne();
        res.json({ message: "Task deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = {
    getDashboardData, getUserDashboardData,
    getTasks, getTaskById, getCategories, getAnalytics,
    createTask, updateTask,
    updateTaskCheckList, updateTaskStatus, reviewTask,
    addComment, deleteComment, uploadAttachments,
    deleteTask,
    // exported for server/test.smoke.js
    buildFilters, buildSort, syncProgress, escapeRegex,
};
