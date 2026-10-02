const mongoose = require('mongoose');
const Project = require('../model/project.model.js');
const { headedDepartmentIds } = require('./scope.js');

const idStr = (value) => String(value?._id || value);

/**
 * Projects a user may see: admins all; everyone else the projects they manage,
 * belong to or created, plus every project of a department they sit in.
 */
const projectScopeFor = (user) => {
    if (user.role === "admin") return {};
    const departments = (user.memberships || []).map((m) => m.department);
    return { $or: [
        { manager: user._id },
        { members: user._id },
        { createdBy: user._id },
        ...(departments.length ? [{ department: { $in: departments } }] : []),
    ] };
};

const canViewProject = async (user, project) => (
    user.role === "admin" || Boolean(await Project.exists({ _id: project._id, ...projectScopeFor(user) }))
);

/** Edit rights: admin, the manager, the creator, or head of the project's department. */
const canManageProject = (user, project) => (
    user.role === "admin"
    || [project.manager, project.createdBy].some((id) => id && idStr(id) === idStr(user._id))
    || (project.department && headedDepartmentIds(user).map(idStr).includes(idStr(project.department)))
);

/** Loads a project the user may view, or sends the 404 itself and returns null. */
const loadViewableProject = async (req, res, id = req.params.id) => {
    const project = mongoose.isValidObjectId(id) ? await Project.findById(id) : null;
    // 404 for "not yours" too, so a response never confirms a project exists.
    if (!project || !(await canViewProject(req.user, project))) {
        res.status(404).json({ message: "Project not found" });
        return null;
    }
    return project;
};

module.exports = { projectScopeFor, canViewProject, canManageProject, loadViewableProject };
