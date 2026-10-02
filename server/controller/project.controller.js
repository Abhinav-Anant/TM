const mongoose = require('mongoose');
const Project = require('../model/project.model.js');
const { PROJECT_STATUSES } = require('../model/project.model.js');
const Task = require('../model/task.model.js');
const User = require('../model/user.model.js');
const Department = require('../model/department.model.js');
const { PRIORITIES, CLOSED } = require('../utils/taskStatus.js');
const { normalizeTags } = require('../utils/taskLinks.js');
const { headedDepartmentIds } = require('../utils/scope.js');
const { projectScopeFor, canManageProject, loadViewableProject } = require('../utils/projectScope.js');

const fail = (res, error) => res.status(500).json({ message: "Server error", error: error.message });
const idStr = (value) => String(value?._id || value);
const DAY = 24 * 60 * 60 * 1000;
const PEOPLE = "name email profileImageUrl";

const emptyStats = { total: 0, completed: 0, inProgress: 0, overdue: 0, blocked: 0, dueSoon: 0, progress: 0 };

/**
 * Dashboard numbers for many projects in one query. Cancelled tasks are ignored
 * entirely; "blocked" is a Blocked status or an unfinished task it waits on.
 */
const statsFor = async (projectIds) => {
    if (!projectIds.length) return new Map();
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * DAY);
    const open = { $not: [{ $in: ["$status", CLOSED] }] };
    const hasDue = { $ne: ["$dueDate", null] }; // null sorts below every date, so guard before comparing
    const count = (cond) => ({ $sum: { $cond: [cond, 1, 0] } });

    const rows = await Task.aggregate([
        { $match: { project: { $in: projectIds } } },
        { $lookup: { from: "tasks", localField: "blockedBy", foreignField: "_id", as: "blockers" } },
        { $group: {
            _id: "$project",
            total: count({ $ne: ["$status", "Cancelled"] }),
            completed: count({ $eq: ["$status", "Completed"] }),
            inProgress: count({ $eq: ["$status", "In Progress"] }),
            overdue: count({ $and: [open, hasDue, { $lt: ["$dueDate", now] }] }),
            blocked: count({ $and: [open, { $or: [
                { $eq: ["$status", "Blocked"] },
                { $gt: [{ $size: { $filter: { input: "$blockers", cond: { $not: [{ $in: ["$$this.status", CLOSED] }] } } } }, 0] },
            ] }] }),
            dueSoon: count({ $and: [open, hasDue, { $gte: ["$dueDate", now] }, { $lte: ["$dueDate", soon] }] }),
        } },
    ]);

    return new Map(rows.map(({ _id, ...s }) => [
        String(_id),
        { ...s, progress: s.total ? Math.round((s.completed / s.total) * 100) : 0 },
    ]));
};

/** Validates and normalises a create/update body. Returns { error } or { data }. */
const cleanProject = async (body, user, existing) => {
    const data = {};
    const bad = (message, status = 400) => ({ error: { message, status } });

    if ("name" in body || !existing) {
        const name = String(body.name || "").trim();
        if (!name) return bad("Project name is required");
        data.name = name;
    }
    if ("description" in body) data.description = String(body.description || "").slice(0, 5000);
    if ("status" in body) {
        if (!PROJECT_STATUSES.includes(body.status)) return bad(`status must be one of ${PROJECT_STATUSES.join(", ")}`);
        data.status = body.status;
    }
    if ("priority" in body) {
        if (!PRIORITIES.includes(body.priority)) return bad(`priority must be one of ${PRIORITIES.join(", ")}`);
        data.priority = body.priority;
    }
    if ("tags" in body) data.tags = normalizeTags(body.tags);

    for (const field of ["startDate", "dueDate"]) {
        if (!(field in body)) continue;
        const date = body[field] ? new Date(body[field]) : null;
        if (date && Number.isNaN(date.getTime())) return bad(`${field} is not a valid date`);
        data[field] = date;
    }
    const start = "startDate" in data ? data.startDate : existing?.startDate;
    const due = "dueDate" in data ? data.dueDate : existing?.dueDate;
    if (start && due && due < start) return bad("The due date cannot be before the start date");

    if ("manager" in body) {
        if (body.manager && (!mongoose.isValidObjectId(body.manager) || !(await User.exists({ _id: body.manager })))) {
            return bad("Project manager not found", 404);
        }
        data.manager = body.manager || null;
    }
    if ("members" in body) {
        const ids = [...new Set((Array.isArray(body.members) ? body.members : []).map(String))];
        if (ids.some((id) => !mongoose.isValidObjectId(id)) || (await User.countDocuments({ _id: { $in: ids } })) !== ids.length) {
            return bad("One of the members does not exist", 404);
        }
        data.members = ids;
    }
    if ("department" in body) {
        const dept = body.department || null;
        if (dept && (!mongoose.isValidObjectId(dept) || !(await Department.exists({ _id: dept })))) return bad("Department not found", 404);
        // A head runs their own department's projects, not anyone else's.
        const changed = idStr(dept) !== idStr(existing?.department || "");
        if (dept && changed && user.role !== "admin" && !headedDepartmentIds(user).map(idStr).includes(idStr(dept))) {
            return bad("You can only use a department you head", 403);
        }
        data.department = dept;
    }
    return { data };
};

const populateProject = (query) => query
    .populate("manager", PEOPLE)
    .populate("members", PEOPLE)
    .populate("department", "name")
    .populate("createdBy", "name");

const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getProjects = async (req, res) => {
    try {
        const { status, department, search } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 24));

        const filter = { ...projectScopeFor(req.user) };
        // Both scope and search may need $or: combine them rather than overwrite.
        const and = [];
        if (filter.$or) { and.push({ $or: filter.$or }); delete filter.$or; }
        if (search && search.trim()) and.push({ name: new RegExp(escapeRegex(search.trim()), "i") });
        if (and.length) filter.$and = and;
        if (status && PROJECT_STATUSES.includes(status)) filter.status = status;
        if (department && mongoose.isValidObjectId(department)) filter.department = department;

        const [projects, total] = await Promise.all([
            populateProject(Project.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit)).lean(),
            Project.countDocuments(filter),
        ]);
        const stats = await statsFor(projects.map((p) => p._id));

        res.json({
            projects: projects.map((p) => ({ ...p, stats: stats.get(String(p._id)) || emptyStats })),
            pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) { fail(res, error); }
};

const getProjectById = async (req, res) => {
    try {
        const found = await loadViewableProject(req, res);
        if (!found) return;
        const project = await populateProject(Project.findById(found._id)).lean();
        const stats = await statsFor([found._id]);
        res.json({ ...project, stats: stats.get(String(found._id)) || emptyStats, canManage: canManageProject(req.user, found) });
    } catch (error) { fail(res, error); }
};

const createProject = async (req, res) => {
    try {
        const { data, error } = await cleanProject(req.body, req.user);
        if (error) return res.status(error.status).json({ message: error.message });
        const project = await Project.create({ ...data, createdBy: req.user._id });
        res.status(201).json({ message: "Project created", project });
    } catch (error) { fail(res, error); }
};

const updateProject = async (req, res) => {
    try {
        const project = await loadViewableProject(req, res);
        if (!project) return;
        if (!canManageProject(req.user, project)) return res.status(403).json({ message: "Not authorized to edit this project" });
        const { data, error } = await cleanProject(req.body, req.user, project);
        if (error) return res.status(error.status).json({ message: error.message });
        project.set(data);
        await project.save();
        res.json({ message: "Project updated", project });
    } catch (error) { fail(res, error); }
};

// Admin only (route-level). Tasks survive: they just stop belonging to a project.
const deleteProject = async (req, res) => {
    try {
        const project = mongoose.isValidObjectId(req.params.id) ? await Project.findById(req.params.id) : null;
        if (!project) return res.status(404).json({ message: "Project not found" });
        await Task.updateMany({ project: project._id }, { $set: { project: null } });
        await project.deleteOne();
        res.json({ message: "Project deleted" });
    } catch (error) { fail(res, error); }
};

module.exports = { getProjects, getProjectById, createProject, updateProject, deleteProject, statsFor };
