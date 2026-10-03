const excelJS = require('exceljs');
const Task = require('../model/task.model.js');
const User = require('../model/user.model.js');
const Project = require('../model/project.model.js');
const Department = require('../model/department.model.js');
const { OPEN } = require('../utils/taskStatus.js');
const { scopeFor, departmentMemberIds, headedDepartmentIds } = require('../utils/scope.js');
const { projectScopeFor } = require('../utils/projectScope.js');
const { parseRange, dayBounds, DAY } = require('../utils/workTime.js');
const { sendReport } = require('../utils/reportFormats.js');
const { statsFor } = require('./project.controller.js');

// Export Task Report as an Excel file
const exportTasksReport = async (req, res) => {
    try {
        // Fetch tasks and populate assignedTo field with user details
        // Same scope as the task list: a head exports their department, an admin everything.
        const tasks = await Task.find(await scopeFor(req.user)).sort({ createdAt: 1 }).populate("assignedTo", "name email");

        // Create a new Excel workbook and worksheet
        const workbook = new excelJS.Workbook();
        const worksheet = workbook.addWorksheet('Task Report');

        // Define columns for the task report
        worksheet.columns = [
            { header: "Task ID", key: "_id", width: 25 },
            { header: "Title", key: "title", width: 30 },
            { header: "Description", key: "description", width: 50 },
            { header: "Priority", key: "priority", width: 15 },
            { header: "Status", key: "status", width: 20 },
            { header: "Due Date", key: "dueDate", width: 20 },
            { header: "Assigned To", key: "assignedTo", width: 30 }
        ];

        // Loop through tasks and add rows to the worksheet
        tasks.forEach((task) => {
            const assignedTo = task.assignedTo
                .map((user) => `${user.name} (${user.email})`)
                .join(", ");

            worksheet.addRow({
                _id: task._id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                status: task.status,
                dueDate: task.dueDate ? task.dueDate.toISOString().split("T")[0] : "",
                assignedTo: assignedTo || "Unassigned"
            });
        });

        // Set the response headers for downloading the Excel file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=tasks_report.xlsx');

        // Write the workbook to the response
        workbook.xlsx.write(res).then(() => {
            res.end();
        });

    } catch (error) {
        res.status(500).json({
            message: "Error exporting tasks",
            error: error.message
        });
    }
};

// Export User Report as an Excel file
const exportUsersReport = async (req, res) => {
    try {
        // Fetch users from the database
        const users = await User.find().select("name email _id role createdAt").lean();

        const userTask = await Task.find().populate("assignedTo", "name email _id");

        const userTaskMap = {};
        users.forEach((user) => {
            userTaskMap[user._id] = {
                name: user.name,
                email: user.email,
                taskCount: 0,
                pendingTasks: 0,
                inProgressTasks: 0,
                inReviewTasks: 0,
                completedTasks: 0,
            };
        });

        userTask.forEach((task) => {
            if (task.assignedTo) {
                task.assignedTo.forEach((assignedUser) => {
                    if (userTaskMap[assignedUser._id]) {
                        userTaskMap[assignedUser._id].taskCount += 1;
                        if (task.status === "To Do") {
                            userTaskMap[assignedUser._id].pendingTasks += 1;
                        } else if (task.status === "In Progress") {
                            userTaskMap[assignedUser._id].inProgressTasks += 1;
                        } else if (task.status === "In Review") {
                            userTaskMap[assignedUser._id].inReviewTasks += 1;
                        } else if (task.status === "Completed") {
                            userTaskMap[assignedUser._id].completedTasks += 1;
                        }
                    }
                });
            }
        });

        // Create a new Excel workbook and worksheet
        const workbook = new excelJS.Workbook();
        const worksheet = workbook.addWorksheet('User Task Report');

        // Define columns for the user report
        worksheet.columns = [
            { header: "Name", key: "name", width: 30 },
            { header: "Email", key: "email", width: 40 },
            { header: "Total Assigned Task", key: "taskCount", width: 20 },
            { header: "Pending Tasks", key: "pendingTasks", width: 20 },
            { header: "In Progress Tasks", key: "inProgressTasks", width: 20 },
            { header: "In Review Tasks", key: "inReviewTasks", width: 20 },
            { header: "Completed Tasks", key: "completedTasks", width: 20 },
        ];

        // Loop through users and add rows to the worksheet
        users.forEach((user) => {
            worksheet.addRow({
                name: user.name,
                email: user.email,
                taskCount: userTaskMap[user._id].taskCount,
                pendingTasks: userTaskMap[user._id].pendingTasks,
                inProgressTasks: userTaskMap[user._id].inProgressTasks,
                inReviewTasks: userTaskMap[user._id].inReviewTasks,
                completedTasks: userTaskMap[user._id].completedTasks,
            });
        });

        // Set the response headers for downloading the Excel file
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=users_report.xlsx');

        // Write the workbook to the response
        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        res.status(500).json({
            message: "Error exporting users",
            error: error.message
        });
    }
};

// ---------------------------------------------------------------------------------------------
// Reports. Four small ones, each a table: Task, Employee, Department, Project.
// Admin sees everything; a head sees their own department. Each returns
//   { kind, title, range, columns, rows, totals }
// and the same object becomes the screen, the CSV and the Excel file (?format=csv|xlsx).
// ---------------------------------------------------------------------------------------------
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
const inRange = (date, range) => date && date >= range.from && date <= range.to;
// A task due on a given day is on time if it finished any time that day (due dates are day-granular).
const onTime = (task) => task.dueDate && task.completedAt && task.completedAt.getTime() <= task.dueDate.getTime() + DAY;

const taskReport = async (user, range, today) => {
    const scope = await scopeFor(user);
    const [created, completed, open, overdue, blocked, createdRows, completedRows] = await Promise.all([
        Task.countDocuments({ ...scope, createdAt: { $gte: range.from, $lte: range.to } }),
        Task.countDocuments({ ...scope, status: "Completed", completedAt: { $gte: range.from, $lte: range.to } }),
        Task.countDocuments({ ...scope, status: OPEN }),
        Task.countDocuments({ ...scope, status: OPEN, dueDate: { $lt: today.start } }),
        Task.countDocuments({ ...scope, status: "Blocked" }),
        Task.find({ ...scope, createdAt: { $gte: range.from, $lte: range.to } }).select("createdAt").lean(),
        Task.find({ ...scope, status: "Completed", completedAt: { $gte: range.from, $lte: range.to } }).select("completedAt").lean(),
    ]);

    // One row per day, in the caller's timezone, so "created today" matches their calendar.
    const dayKey = (date) => new Date(date.getTime() - range.tzOffset * 60000).toISOString().slice(0, 10);
    const perDay = new Map();
    for (let t = range.from.getTime(); t <= range.to.getTime(); t += DAY) perDay.set(dayKey(new Date(t)), { date: dayKey(new Date(t)), created: 0, completed: 0 });
    createdRows.forEach((r) => { const row = perDay.get(dayKey(r.createdAt)); if (row) row.created += 1; });
    completedRows.forEach((r) => { const row = perDay.get(dayKey(r.completedAt)); if (row) row.completed += 1; });

    return {
        title: "Task report",
        // The five numbers the spec asks for are the table (and so the CSV / Excel file);
        // the per-day trend is extra detail for the screen.
        columns: [
            { key: "metric", header: "Metric", width: 18 },
            { key: "count", header: "Count", width: 10 },
        ],
        rows: [
            { metric: "Created", count: created },
            { metric: "Completed", count: completed },
            { metric: "Open", count: open },
            { metric: "Overdue", count: overdue },
            { metric: "Blocked", count: blocked },
        ],
        trend: [...perDay.values()],
    };
};

const employeeReport = async (user, range, today) => {
    const scope = await scopeFor(user);
    const led = headedDepartmentIds(user);
    const userFilter = user.role === "admin" ? {} : { _id: { $in: await departmentMemberIds(led) } };

    const cond = (c) => ({ $sum: { $cond: [c, 1, 0] } });
    const open = { $not: [{ $in: ["$status", ["Completed", "Cancelled"]] }] };
    const doneInRange = { $and: [{ $eq: ["$status", "Completed"] }, { $gte: ["$completedAt", range.from] }, { $lte: ["$completedAt", range.to] }] };
    const hasDue = { $ne: ["$dueDate", null] };

    const [people, groups] = await Promise.all([
        User.find(userFilter).select("name email memberships").populate("memberships.department", "name").sort({ name: 1 }).limit(500).lean(),
        Task.aggregate([
            { $match: scope },
            { $unwind: "$assignedTo" },
            { $group: {
                _id: "$assignedTo",
                assigned: cond({ $and: [{ $gte: ["$createdAt", range.from] }, { $lte: ["$createdAt", range.to] }] }),
                completed: cond(doneInRange),
                completedWithDue: cond({ $and: [doneInRange, hasDue] }),
                onTime: cond({ $and: [doneInRange, hasDue, { $lte: ["$completedAt", { $add: ["$dueDate", DAY] }] }] }),
                overdue: cond({ $and: [open, hasDue, { $lt: ["$dueDate", today.start] }] }),
                open: cond(open),
            } },
        ]),
    ]);

    const numbers = new Map(groups.map((g) => [String(g._id), g]));
    const rows = people.map((p) => {
        const g = numbers.get(String(p._id)) || {};
        return {
            name: p.name,
            email: p.email,
            departments: (p.memberships || []).map((m) => m.department?.name).filter(Boolean).join(", "),
            assigned: g.assigned || 0,
            completed: g.completed || 0,
            onTime: g.onTime || 0,
            onTimeRate: pct(g.onTime || 0, g.completedWithDue || 0),
            open: g.open || 0,
            overdue: g.overdue || 0,
        };
    });

    const sum = (key) => rows.reduce((n, r) => n + r[key], 0);
    return {
        title: "Employee report",
        columns: [
            { key: "name", header: "Employee", width: 26 },
            { key: "email", header: "Email", width: 30 },
            { key: "departments", header: "Departments", width: 24 },
            { key: "assigned", header: "Assigned", width: 11 },
            { key: "completed", header: "Completed", width: 12 },
            { key: "onTime", header: "On time", width: 10 },
            { key: "onTimeRate", header: "On-time %", width: 11 },
            { key: "open", header: "Open", width: 8 },
            { key: "overdue", header: "Overdue", width: 10 },
        ],
        rows,
        totals: { name: "Total", assigned: sum("assigned"), completed: sum("completed"), onTime: sum("onTime"), open: sum("open"), overdue: sum("overdue") },
    };
};

/**
 * A task counts toward its own department when it has one, otherwise toward the department(s) of the people
 * it is assigned to. Tasks nobody in a department is on land in "No department" (admin only).
 * ponytail: tasks are read into memory (open + finished in range). Fine for thousands; use an aggregation if it ever isn't.
 */
const departmentReport = async (user, range, today) => {
    const led = headedDepartmentIds(user).map(String);
    const [departments, tasks] = await Promise.all([
        Department.find(user.role === "admin" ? {} : { _id: { $in: led } }).select("name").sort({ name: 1 }).lean(),
        Task.find({ ...(await scopeFor(user)), $or: [{ status: OPEN }, { status: "Completed", completedAt: { $gte: range.from, $lte: range.to } }] })
            .select("status dueDate department assignedTo").lean(),
    ]);
    const assignees = [...new Set(tasks.flatMap((t) => t.assignedTo.map(String)))];
    const memberships = new Map((await User.find({ _id: { $in: assignees } }).select("memberships").lean())
        .map((u) => [String(u._id), (u.memberships || []).map((m) => String(m.department))]));

    const empty = () => ({ open: 0, completed: 0, overdue: 0, blocked: 0 });
    const buckets = new Map(departments.map((d) => [String(d._id), { name: d.name, ...empty() }]));
    if (user.role === "admin") buckets.set("none", { name: "No department", ...empty() });

    for (const task of tasks) {
        const owners = task.department ? [String(task.department)] : [...new Set(task.assignedTo.flatMap((id) => memberships.get(String(id)) || []))];
        const targets = (owners.length ? owners : ["none"]).filter((id) => buckets.has(id));
        for (const id of targets) {
            const b = buckets.get(id);
            if (task.status === "Completed") b.completed += 1;
            else {
                b.open += 1;
                if (task.status === "Blocked") b.blocked += 1;
                if (task.dueDate && task.dueDate < today.start) b.overdue += 1;
            }
        }
    }

    const rows = [...buckets.values()];
    const sum = (key) => rows.reduce((n, r) => n + r[key], 0);
    return {
        title: "Department report",
        columns: [
            { key: "name", header: "Department", width: 28 },
            { key: "open", header: "Open", width: 10 },
            { key: "completed", header: "Completed", width: 12 },
            { key: "overdue", header: "Overdue", width: 10 },
            { key: "blocked", header: "Blocked", width: 10 },
        ],
        rows,
        totals: { name: "Total", open: sum("open"), completed: sum("completed"), overdue: sum("overdue"), blocked: sum("blocked") },
    };
};

// Projects are a current-state report (their numbers are the project dashboard's), so the date range does not apply.
const projectReport = async (user) => {
    const projects = await Project.find(projectScopeFor(user)).sort({ name: 1 }).limit(500)
        .populate("manager", "name").populate("department", "name").lean();
    const stats = await statsFor(projects.map((p) => p._id));
    const rows = projects.map((p) => {
        const s = stats.get(String(p._id)) || { total: 0, completed: 0, overdue: 0, progress: 0 };
        return {
            name: p.name,
            status: p.status,
            manager: p.manager?.name || "",
            department: p.department?.name || "",
            dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : "",
            open: s.total - s.completed,
            completed: s.completed,
            overdue: s.overdue,
            progress: s.progress,
        };
    });
    return {
        title: "Project report",
        columns: [
            { key: "name", header: "Project", width: 30 },
            { key: "status", header: "Status", width: 12 },
            { key: "manager", header: "Manager", width: 22 },
            { key: "department", header: "Department", width: 20 },
            { key: "dueDate", header: "Due", width: 12 },
            { key: "open", header: "Open", width: 8 },
            { key: "completed", header: "Completed", width: 12 },
            { key: "overdue", header: "Overdue", width: 10 },
            { key: "progress", header: "Progress %", width: 12 },
        ],
        rows,
    };
};

const REPORTS = { tasks: taskReport, employees: employeeReport, departments: departmentReport, projects: projectReport };

// GET /api/reports/:kind?from=&to=&tzOffset=&format=csv|xlsx   (admin / head; route-gated)
const getReport = async (req, res) => {
    try {
        const build = REPORTS[req.params.kind];
        if (!build) return res.status(404).json({ message: `Unknown report. Choose one of: ${Object.keys(REPORTS).join(", ")}` });

        const tzOffset = parseInt(req.query.tzOffset, 10) || 0;
        const range = parseRange(req.query, tzOffset);
        if (range.error) return res.status(400).json({ message: range.error });
        range.tzOffset = tzOffset;

        const report = await build(req.user, range, dayBounds(tzOffset));
        if (req.query.format === "csv" || req.query.format === "xlsx") return sendReport(res, report, req.query.format);

        res.json({
            kind: req.params.kind,
            range: { from: range.from, to: range.to },
            ...report,
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = { exportTasksReport, exportUsersReport, getReport };
