const Task = require('../model/task.model.js');
const Project = require('../model/project.model.js');
const User = require('../model/user.model.js');
const Department = require('../model/department.model.js');
const { scopeFor } = require('../utils/scope.js');
const { projectScopeFor } = require('../utils/projectScope.js');

const PER_KIND = 5;
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/search?q= - one box over tasks, projects, people and departments.
 * Every kind is scoped like its own list: you only find what you could already open.
 *   people:      admin = everyone; everyone else = people who share a department with them (and themselves)
 *   departments: admin = all; everyone else = the ones they belong to
 */
const search = async (req, res) => {
    try {
        const q = String(req.query.q || "").trim().slice(0, 80);
        if (q.length < 2) return res.json({ tasks: [], projects: [], people: [], departments: [] });
        const rx = new RegExp(escapeRegex(q), "i");

        const myDepartments = (req.user.memberships || []).map((m) => m.department);
        const isAdmin = req.user.role === "admin";

        const projectScope = projectScopeFor(req.user);
        const projectFilter = { name: rx, ...(projectScope.$or ? { $and: [{ $or: projectScope.$or }] } : {}) };
        const peopleFilter = {
            $or: [{ name: rx }, { email: rx }],
            ...(isAdmin ? {} : { $and: [{ $or: [{ _id: req.user._id }, { 'memberships.department': { $in: myDepartments } }] }] }),
        };

        const [tasks, projects, people, departments] = await Promise.all([
            Task.find({ ...(await scopeFor(req.user)), $or: [{ title: rx }, { tags: q.replace(/^#/, "").toLowerCase() }] })
                .sort({ updatedAt: -1 }).limit(PER_KIND).select("title status priority dueDate").lean(),
            Project.find(projectFilter).sort({ updatedAt: -1 }).limit(PER_KIND).select("name status").lean(),
            User.find(peopleFilter).sort({ name: 1 }).limit(PER_KIND).select("name email role profileImageUrl").lean(),
            Department.find({ name: rx, ...(isAdmin ? {} : { _id: { $in: myDepartments } }) }).sort({ name: 1 }).limit(PER_KIND).select("name").lean(),
        ]);

        res.json({ tasks, projects, people, departments });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = { search };
