const Department = require('../model/department.model.js');
const User = require('../model/user.model.js');

const MEMBER_FIELDS = "name email profileImageUrl role";

/** A head may only ever act on the department they belong to. */
const deniedForHead = (req) =>
    req.user.role === "head" && String(req.user.department || "") !== String(req.params.id);

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

// Admins get the whole org; a head only ever sees their own department.
const getDepartments = async (req, res) => {
    try {
        const filter = req.user.role === "head" ? { _id: req.user.department } : {};
        if (req.user.role === "head" && !req.user.department) {
            return res.json({ departments: [] });
        }

        const departments = await Department.find(filter).sort({ name: 1 }).lean();

        // ponytail: one count per department - departments are few. Switch to a
        // single $group aggregate if that ever stops being true.
        const withCounts = await Promise.all(departments.map(async (department) => ({
            ...department,
            memberCount: await User.countDocuments({ department: department._id }),
        })));

        res.json({ departments: withCounts });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const updateDepartment = async (req, res) => {
    try {
        const name = (req.body.name || "").trim();
        if (!name) {
            return res.status(400).json({ message: "Department name is required" });
        }

        const department = await Department.findByIdAndUpdate(
            req.params.id, { name }, { new: true }
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
        await User.updateMany({ department: department._id }, { $set: { department: null } });
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

        const members = await User.find({ department: department._id })
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

        // One head per department. Moving a head in while another already holds
        // the post would leave two people with assign rights over the same team.
        if (user.role === "head") {
            const existingHead = await User.findOne({
                department: department._id,
                role: "head",
                _id: { $ne: user._id },
            });
            if (existingHead) {
                return res.status(409).json({
                    message: `${existingHead.name} is already head of this department`,
                });
            }
        }

        user.department = department._id;
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
        if (String(user.department || "") !== String(req.params.id)) {
            return res.status(400).json({ message: "User is not in this department" });
        }

        user.department = null;
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
