/**
 * Who may see and touch what.
 *
 * Membership lives in one place only - `User.department`. Headship is derived
 * (`role === "head"` + that user's department), so there is no second copy of
 * the org chart to drift out of sync.
 */
const User = require('../model/user.model.js');

const idStr = (value) => String(value?._id || value);

/** Every user in a department, the head included. Empty for a head with no department. */
const departmentMemberIds = async (departmentId) => {
    if (!departmentId) return [];
    const members = await User.find({ department: departmentId }).select('_id').lean();
    return members.map((member) => member._id);
};

/**
 * Mongo filter narrowing a query to what `user` is allowed to see.
 *
 * `field` is the ownership field on the collection being queried - tasks use
 * `assignedTo` (an array), leads use `owner` (a single id). The `$in` branch is
 * correct against both.
 */
const scopeFor = async (user, field = 'assignedTo') => {
    if (user.role === "admin") return {};
    if (user.role === "head") {
        return { [field]: { $in: await departmentMemberIds(user.department) } };
    }
    return { [field]: user._id };
};

/** May `user` open / comment on / update this task? */
const canAccessTask = async (user, task) => {
    if (user.role === "admin") return true;

    const assignees = (task.assignedTo || []).map(idStr);
    if (assignees.includes(idStr(user._id))) return true;

    if (user.role === "head") {
        const memberIds = (await departmentMemberIds(user.department)).map(idStr);
        return assignees.some((assignee) => memberIds.includes(assignee));
    }
    return false;
};

/** May `user` assign work to *every* id in `userIds`? Heads are limited to their own department. */
const canAssignTo = async (user, userIds) => {
    if (user.role === "admin") return true;
    if (user.role !== "head" || !user.department) return false;

    const memberIds = (await departmentMemberIds(user.department)).map(idStr);
    return userIds.every((id) => memberIds.includes(idStr(id)));
};

module.exports = { departmentMemberIds, scopeFor, canAccessTask, canAssignTo, idStr };
