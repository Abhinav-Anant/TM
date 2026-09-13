const Task = require('../model/task.model.js');
const User = require('../model/user.model.js');
const { notify } = require('../utils/notify.js');

const SORTABLE_FIELDS = ["dueDate", "createdAt", "updatedAt", "priority", "progress", "title"];
const PRIORITY_ORDER = { High: 3, Medium: 2, Low: 1 };

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Admins see everything, members only what is assigned to them. */
const scopeFor = (user) => (user.role === "admin" ? {} : { assignedTo: user._id });

/**
 * Builds the Mongo filter from the query string.
 * Returns `base` (everything except status) so the status tab counts stay
 * consistent with the other active filters.
 */
const buildFilters = (user, query) => {
    const { status, priority, category, search, dueBefore, dueAfter, overdue } = query;
    const base = { ...scopeFor(user) };

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

const getDashboardData = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        const [
            allTasksCount,
            pendingTasksCount,
            inProgressTasksCount,
            completedTasksCount,
            overdueTasksCount,
            allUsersCount,
            assignedUserIds,
        ] = await Promise.all([
            Task.countDocuments(),
            Task.countDocuments({ status: 'Pending' }),
            Task.countDocuments({ status: 'In Progress' }),
            Task.countDocuments({ status: 'Completed' }),
            Task.countDocuments({ status: { $ne: 'Completed' }, dueDate: { $lt: new Date() } }),
            User.countDocuments(),
            Task.distinct("assignedTo"),
        ]);

        res.status(200).json({
            message: "Dashboard data retrieved successfully",
            data: {
                allTasksCount,
                pendingTasksCount,
                inProgressTasksCount,
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

        const statusSummary = { Pending: 0, InProgress: 0, Completed: 0 };
        const prioritySummary = { Low: 0, Medium: 0, High: 0 };

        assignedTasks.forEach((task) => {
            if (task.status === "Pending") statusSummary.Pending += 1;
            else if (task.status === "In Progress") statusSummary.InProgress += 1;
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
        const { base, filter } = buildFilters(req.user, req.query);

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

        const [allTasks, pendingTasks, inProgressTasks, completedTasks] = await Promise.all([
            Task.countDocuments(base),
            countByStatus("Pending"),
            countByStatus("In Progress"),
            countByStatus("Completed"),
        ]);

        res.json({
            tasks: tasks.map(withCompletedCount),
            statusSummary: { all: allTasks, pendingTasks, inProgressTasks, completedTasks },
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getCategories = async (req, res) => {
    try {
        const categories = await Task.distinct("category", scopeFor(req.user));
        res.json({ categories: categories.filter(Boolean).sort() });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getAnalytics = async (req, res) => {
    try {
        const scope = scopeFor(req.user);
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

        // Members may only open tasks assigned to them - a task id is guessable
        // and the document carries descriptions, attachments and comments.
        const isAssigned = (task.assignedTo || []).some(
            (user) => user._id.toString() === req.user._id.toString()
        );
        if (!isAssigned && req.user.role !== "admin") {
            return res.status(403).json({ message: "Not authorized to view this task" });
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const createTask = async (req, res) => {
    try {
        const {
            title, description, priority, category,
            dueDate, assignedTo, attachments, todoChecklist
        } = req.body;

        if (!Array.isArray(assignedTo)) {
            return res.status(400).json({ message: "assigned-to must be an array of user ID's" });
        }

        const task = await Task.create({
            title, description, priority,
            category: category || "General",
            dueDate, assignedTo,
            createdBy: req.user._id,
            attachments,
            todoChecklist,
        });

        await notify({
            userIds: assignedTo,
            actorId: req.user._id,
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

        const previousAssignees = (task.assignedTo || []).map(String);

        task.title = req.body.title || task.title;
        task.description = req.body.description || task.description;
        task.priority = req.body.priority || task.priority;
        task.category = req.body.category || task.category;
        task.dueDate = req.body.dueDate || task.dueDate;
        task.todoChecklist = req.body.todoChecklist || task.todoChecklist;
        task.attachments = req.body.attachments || task.attachments;

        if (req.body.assignedTo) {
            if (!Array.isArray(req.body.assignedTo)) {
                return res.status(400).json({ message: "assigned-to must be an array of user ID's" });
            }
            task.assignedTo = req.body.assignedTo;
        }

        const updatedTask = await task.save();

        const currentAssignees = (updatedTask.assignedTo || []).map(String);

        await notify({
            userIds: currentAssignees.filter((id) => !previousAssignees.includes(id)),
            actorId: req.user._id,
            type: "assigned",
            task: task._id,
            title: `New task: ${task.title}`,
            message: `${req.user.name} assigned you "${task.title}", due ${new Date(task.dueDate).toDateString()}.`,
        });

        await notify({
            userIds: currentAssignees.filter((id) => previousAssignees.includes(id)),
            actorId: req.user._id,
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

/** Recomputes progress + status from the checklist. */
const syncProgress = (task) => {
    const total = task.todoChecklist.length;
    const done = task.todoChecklist.filter((item) => item.completed).length;
    task.progress = total > 0 ? Math.round((done / total) * 100) : 0;

    if (total > 0 && task.progress === 100) task.status = "Completed";
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

        const isAssigned = (task.assignedTo || []).some(
            (userId) => userId.toString() === req.user._id.toString()
        );
        if (!isAssigned && req.user.role !== "admin") {
            return res.status(403).json({ message: "Not authorized to update checklist" });
        }

        const wasCompleted = task.status === "Completed";
        task.todoChecklist = todoChecklist;
        syncProgress(task);
        await task.save();

        if (!wasCompleted && task.status === "Completed") {
            await notify({
                userIds: watchersOf(task),
                actorId: req.user._id,
                type: "status",
                task: task._id,
                title: `Completed: ${task.title}`,
                message: `${req.user.name} completed "${task.title}".`,
            });
        }

        const updatedTask = await Task.findById(req.params.id)
            .populate("assignedTo", "name email profileImageUrl")
            .populate("comments.user", "name email profileImageUrl");

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

        const isAssigned = (task.assignedTo || []).some(
            (userId) => userId.toString() === req.user._id.toString()
        );
        if (!isAssigned && req.user.role !== "admin") {
            return res.status(403).json({ message: "Not Authorized" });
        }

        const previousStatus = task.status;
        task.status = req.body.status;

        if (task.status === "Completed") {
            task.todoChecklist.forEach((item) => { item.completed = true; });
            task.progress = 100;
            task.completedAt = task.completedAt || new Date();
        } else {
            const total = task.todoChecklist.length;
            const done = task.todoChecklist.filter((item) => item.completed).length;
            task.progress = total ? Math.round((done / total) * 100) : 0;
            task.completedAt = null;
        }

        const updatedTask = await task.save();

        if (previousStatus !== task.status) {
            await notify({
                userIds: watchersOf(task),
                actorId: req.user._id,
                type: "status",
                task: task._id,
                title: `${task.title} is now ${task.status}`,
                message: `${req.user.name} moved "${task.title}" from ${previousStatus} to ${task.status}.`,
            });
        }

        res.json({ message: "Task status updated successfully", updatedTask });
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

        const isAssigned = (task.assignedTo || []).some(
            (userId) => userId.toString() === req.user._id.toString()
        );
        if (!isAssigned && req.user.role !== "admin") {
            return res.status(403).json({ message: "Not authorized to comment on this task" });
        }

        task.comments.push({ user: req.user._id, text });
        await task.save();

        await notify({
            userIds: watchersOf(task),
            actorId: req.user._id,
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
    updateTaskCheckList, updateTaskStatus,
    addComment, deleteComment, uploadAttachments,
    deleteTask,
    // exported for server/test.smoke.js
    buildFilters, buildSort, syncProgress, escapeRegex,
};
