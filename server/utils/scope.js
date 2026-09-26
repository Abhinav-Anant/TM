/**
 * Who may see and touch what.
 *
 * Membership lives in one place only - `User.memberships`, where each entry
 * names a department and whether this user HEADS it. Headship is not derived
 * from `role`, because a head of one department may sit in another as an
 * ordinary rep and must not gain that team's records.
 *
 * Two independent gates live here. `scopeFor` narrows WHICH RECORDS come
 * back; `modulesFor` decides WHICH SCREENS exist at all. Neither widens the
 * other.
 */
const User = require('../model/user.model.js');
const Department = require('../model/department.model.js');

/** Every module a department can grant. */
const MODULES = ['sales', 'leads'];

const idStr = (value) => String(value?._id || value);

/** The departments this user leads. A plain member leads none. */
const headedDepartmentIds = (user) =>
    (user.memberships || []).filter((m) => m.head).map((m) => m.department);

/** Every user in any of these departments, heads included. */
const departmentMemberIds = async (departmentIds) => {
    const ids = (departmentIds || []).filter(Boolean);
    if (!ids.length) return [];
    const members = await User.find({ 'memberships.department': { $in: ids } }).select('_id').lean();
    return members.map((member) => member._id);
};

/**
 * Mongo filter narrowing a query to what `user` is allowed to see.
 *
 * `field` is the ownership field on the collection being queried - tasks use
 * `assignedTo` (an array), leads use `owner` (a single id). `$in` is correct
 * against both.
 *
 * One branch covers heads and members alike: you always see your own records,
 * plus everyone's in the departments you head. A member heads nothing, so this
 * collapses to themselves.
 */
const scopeFor = async (user, field = 'assignedTo') => {
    if (user.role === "admin") return {};
    const led = headedDepartmentIds(user);
    return { [field]: { $in: [user._id, ...await departmentMemberIds(led)] } };
};

/** May `user` open / comment on / update this task? */
const canAccessTask = async (user, task) => {
    if (user.role === "admin") return true;

    const assignees = (task.assignedTo || []).map(idStr);
    if (assignees.includes(idStr(user._id))) return true;

    const led = headedDepartmentIds(user);
    if (!led.length) return false;

    const memberIds = (await departmentMemberIds(led)).map(idStr);
    return assignees.some((assignee) => memberIds.includes(assignee));
};

/** May `user` assign work to *every* id in `userIds`? Limited to departments they head. */
const canAssignTo = async (user, userIds) => {
    if (user.role === "admin") return true;

    const led = headedDepartmentIds(user);
    if (!led.length) return false;

    const memberIds = (await departmentMemberIds(led)).map(idStr);
    return userIds.every((id) => memberIds.includes(idStr(id)));
};

/** Everyone who heads a department that any of `userIds` belongs to. */
const departmentHeadsOf = async (userIds) => {
    const users = await User.find({ _id: { $in: (userIds || []).map(idStr) } }).select('memberships').lean();
    const departments = [...new Set(
        users.flatMap((user) => (user.memberships || []).map((m) => idStr(m.department)))
    )];
    if (!departments.length) return [];

    // `head: true` matters: a head who is merely a rep in a department does not oversee it.
    const heads = await User.find({
        memberships: { $elemMatch: { department: { $in: departments }, head: true } },
    }).select('_id').lean();
    return heads.map((head) => head._id);
};

/**
 * May `user` sign off a task that needs review? An admin, the task's creator,
 * or the head of an assignee's department - but never someone approving work
 * only they were assigned.
 */
const canReview = async (user, task) => {
    if (user.role === "admin") return true;
    const me = idStr(user._id);
    if ((task.createdBy || []).map(idStr).includes(me)) return true;

    const others = (task.assignedTo || []).map(idStr).filter((id) => id !== me);
    if (!others.length) return false;
    return (await departmentHeadsOf(others)).map(idStr).includes(me);
};

/**
 * Which screens this user may reach. The union across their departments -
 * being in Sales AND Marketing grants both sets.
 *
 * Admins are special-cased: they hold no memberships, so nothing would grant
 * them anything.
 */
const modulesFor = async (user) => {
    if (user.role === "admin") return [...MODULES];

    const ids = (user.memberships || []).map((m) => m.department).filter(Boolean);
    if (!ids.length) return [];

    const departments = await Department.find({ _id: { $in: ids } }).select('modules').lean();
    return [...new Set(departments.flatMap((department) => department.modules || []))];
};

module.exports = {
    MODULES, departmentMemberIds, headedDepartmentIds,
    scopeFor, canAccessTask, canAssignTo, modulesFor, idStr,
    departmentHeadsOf, canReview,
};
