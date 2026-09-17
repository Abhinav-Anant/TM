const Department = require('../model/department.model.js');
const User = require('../model/user.model.js');
const { headedDepartmentIds, MODULES } = require('../utils/scope.js');

const MEMBER_FIELDS = "name email profileImageUrl role";

/** A head may only ever act on a department they actually LEAD - being a rep
 *  in a department grants nothing here. */
const deniedForHead = (req) =>
    req.user.role === "head" &&
    !headedDepartmentIds(req.user).some((id) => String(id) === String(req.params.id));

const createDepartment = async (req, res) => {
    try {
        const name = (req.body.name || "").trim();
        if (!name) {
            return res.status(400).json({ message: "Department name is required" });
        }

        const department = await Department.create({ name });
        res.status(201).json({ message: "Department created successfully", department });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "A department with that name already exists" });
        }
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Admins get the whole org; a head only ever sees departments they lead.
const getDepartments = async (req, res) => {
    try {
        const led = headedDepartmentIds(req.user);
        if (req.user.role === "head" && !led.length) {
            return res.json({ departments: [] });
        }
        const filter = req.user.role === "head" ? { _id: { $in: led } } : {};

        const departments = await Department.find(filter).sort({ name: 1 }).lean();

        // ponytail: one count per department - departments are few. Switch to a
        // single $group aggregate if that ever stops being true.
        const withCounts = await Promise.all(departments.map(async (department) => ({
            ...department,
            memberCount: await User.countDocuments({ 'memberships.department': department._id }),
        })));

        res.json({ departments: withCounts });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const updateDepartment = async (req, res) => {
    try {
        const changes = {};
        if (req.body.name !== undefined) {
            const name = (req.body.name || "").trim();
            if (!name) {
                return res.status(400).json({ message: "Department name is required" });
            }
            changes.name = name;
        }
        // Filtered against the enum: an unknown string would fail validation on
        // save and 500, and silently dropping it is the kinder failure.
        if (req.body.modules !== undefined) {
            changes.modules = (req.body.modules || []).filter((m) => MODULES.includes(m));
        }

        const department = await Department.findByIdAndUpdate(
            req.params.id, changes, { new: true }
        );
        if (!department) {
            return res.status(404).json({ message: "Department not found" });
        }

        res.json({ message: "Department updated successfully", department });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "A department with that name already exists" });
        }
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const deleteDepartment = async (req, res) => {
    try {
        const department = await Department.findById(req.params.id);
        if (!department) {
            return res.status(404).json({ message: "Department not found" });
        }

        // Members outlive their department - detach them rather than orphaning
        // a dangling reference that every scope query would then have to guard.
        await User.updateMany(
            { 'memberships.department': department._id },
            { $pull: { memberships: { department: department._id } } }
        );
        await department.deleteOne();

        res.json({ message: "Department deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const getDepartmentMembers = async (req, res) => {
    try {
        if (deniedForHead(req)) {
            return res.status(403).json({ message: "Not authorized to view this department" });
        }

        const department = await Department.findById(req.params.id);
        if (!department) {
            return res.status(404).json({ message: "Department not found" });
        }

        const members = await User.find({ 'memberships.department': department._id })
            .select(MEMBER_FIELDS)
            .sort({ name: 1 });

        res.json({ department, members });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const addDepartmentMember = async (req, res) => {
    try {
        const department = await Department.findById(req.params.id);
        if (!department) {
            return res.status(404).json({ message: "Department not found" });
        }

        const user = await User.findById(req.body.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        if (user.role === "admin") {
            return res.status(400).json({ message: "Admins do not belong to a department" });
        }

        const wantsHead = Boolean(req.body.head);

        // Headship is a role-level privilege, so a member cannot be made head of
        // anything - otherwise adding a rep to a department would hand them
        // assign rights over the whole team.
        if (wantsHead && user.role !== "head") {
            return res.status(400).json({ message: "Only a user with the head role can lead a department" });
        }

        if (user.memberships.some((m) => String(m.department) === String(department._id))) {
            return res.status(409).json({ message: `${user.name} is already in this department` });
        }

        // One head per department. Two people with assign rights over the same
        // team is the thing this prevents; one person heading TWO departments is
        // fine and deliberate.
        if (wantsHead) {
            const existingHead = await User.findOne({
                memberships: { $elemMatch: { department: department._id, head: true } },
                _id: { $ne: user._id },
            });
            if (existingHead) {
                return res.status(409).json({
                    message: `${existingHead.name} is already head of this department`,
                });
            }
        }

        user.memberships.push({ department: department._id, head: wantsHead });
        await user.save();

        res.json({
            message: "Member added to department",
            user: await User.findById(user._id).select(MEMBER_FIELDS),
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const removeDepartmentMember = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const before = user.memberships.length;
        user.memberships = user.memberships.filter(
            (m) => String(m.department) !== String(req.params.id)
        );
        if (user.memberships.length === before) {
            return res.status(400).json({ message: "User is not in this department" });
        }

        await user.save();

        res.json({ message: "Member removed from department" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = {
    createDepartment, getDepartments, updateDepartment, deleteDepartment,
    getDepartmentMembers, addDepartmentMember, removeDepartmentMember,
};
