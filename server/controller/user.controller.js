const express = require("express");
const Task = require('../model/task.model.js')
const User = require('../model/user.model.js')
const bcrypt = require("bcryptjs");
const mongoose = require('mongoose');
const { departmentMemberIds, headedDepartmentIds, membershipError } = require('../utils/scope.js');
const { normalizePhone } = require('../utils/phone.js');
const Department = require('../model/department.model.js')
const { parseMembersCsv, MIN_PASSWORD_LENGTH, EMAIL_RE } = require('../utils/csv.js')

// ponytail: hashing is serial and in-request (~100ms/row at cost 10). 200 rows fits a
// long-lived request; move to a background job if imports ever get bigger than that.
const MAX_IMPORT_ROWS = 200;


const getUser = async (req, res) => {
    try {
        // Admins may assign to anyone (members and heads alike); a head only ever
        // sees the people in departments they lead.
        const filter = req.user.role === "head"
            ? { _id: { $in: await departmentMemberIds(headedDepartmentIds(req.user)) } }
            : { role: { $in: ["member", "head"] } };

        const users = await User.find(filter)
            .select("-password")
            .populate("memberships.department", "name");

        const usersWithTaskCounts = [];
        for (const user of users) {
            const pendingTasks = await Task.countDocuments({ assignedTo: user._id, status: "To Do" });
            const inProgressTasks = await Task.countDocuments({ assignedTo: user._id, status: "In Progress" });
            const completedTasks = await Task.countDocuments({ assignedTo: user._id, status: "Completed" });

            usersWithTaskCounts.push({
                ...user._doc,
                pendingTasks,
                inProgressTasks,
                completedTasks,
            });
        }

        res.json(usersWithTaskCounts);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};


const getUserById = async (req, res) => {

    try {
        const userId = req.params.id;

        // Heads may only look up their own department; members only themselves.
        if (req.user.role !== "admin") {
            const allowed = req.user.role === "head"
                ? (await departmentMemberIds(headedDepartmentIds(req.user))).map(String)
                : [String(req.user._id)];
            if (!allowed.includes(String(userId))) {
                return res.status(403).json({ message: "Not authorized to view this user" });
            }
        }

        const user = await User.findById(userId).select('-password');
        if (!user) {
            return res.status(404).json({ message: "User not found" })

        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message })

    }
}

/**
 * Bulk-create members from an uploaded CSV (name,email,password[,department]).
 * Emails that already exist are skipped, never overwritten; invalid rows are
 * reported by line number and the remaining valid rows still import.
 */
const importMembers = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No CSV file uploaded" });
        }

        const { rows: parsed, errors } = parseMembersCsv(req.file.buffer.toString("utf8"));

        // Departments are named in the CSV but stored as ids. An unknown name fails its row -
        // importing the user department-less would silently hide them from their head.
        // The whole table is matched in JS: there are a handful of departments, and it keeps
        // admin-supplied names out of a regex entirely.
        const anyNamed = parsed.some((row) => row.department);
        const departments = anyNamed ? await Department.find().select("name").lean() : [];
        const byName = new Map(departments.map((dept) => [dept.name.trim().toLowerCase(), dept._id]));

        const rows = [];
        for (const row of parsed) {
            if (!row.department) { rows.push({ ...row, department: null }); continue; }

            const id = byName.get(row.department.toLowerCase());
            if (!id) { errors.push({ line: row.line, message: `Unknown department: ${row.department}` }); continue; }
            rows.push({ ...row, department: id });
        }
        errors.sort((a, b) => a.line - b.line);

        if (rows.length === 0) {
            return res.status(400).json({ message: "No valid rows found in the CSV", created: 0, skipped: 0, errors });
        }
        if (rows.length > MAX_IMPORT_ROWS) {
            return res.status(400).json({ message: `Too many rows: ${rows.length}. Import at most ${MAX_IMPORT_ROWS} at a time.` });
        }

        // One query instead of one per row; the unique index is still the real guard.
        const existing = await User.find({ email: { $in: rows.map((r) => r.email) } }).select("email");
        const taken = new Set(existing.map((user) => user.email.toLowerCase()));

        const fresh = rows.filter((row) => !taken.has(row.email));
        const skipped = rows.length - fresh.length;

        const docs = [];
        for (const row of fresh) {
            const salt = await bcrypt.genSalt(10);
            docs.push({
                name: row.name,
                email: row.email,
                password: await bcrypt.hash(row.password, salt),
                role: "member",
                // One department per CSV row, joined as an ordinary member.
                memberships: row.department ? [{ department: row.department, head: false }] : [],
            });
        }

        // ordered:false so one racing duplicate cannot discard the rest of the batch.
        let created = 0;
        if (docs.length > 0) {
            try {
                created = (await User.insertMany(docs, { ordered: false })).length;
            } catch (error) {
                created = error.insertedDocs?.length || 0;
                (error.writeErrors || []).forEach((writeError) => {
                    errors.push({ line: 0, message: writeError.err?.errmsg || "Could not insert row" });
                });
            }
        }

        res.status(201).json({
            message: `Imported ${created} member(s).`,
            created,
            skipped,
            failed: errors.length,
            errors,
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const ROLES = ["admin", "head", "member"];

// One person, any role, optionally straight into a department. Department rules
// are the same ones adding someone on the Departments page enforces.
const createUser = async (req, res) => {
    try {
        const { name, password, role, phone, department, head } = req.body;
        const email = String(req.body.email || "").trim().toLowerCase();

        if (!String(name || "").trim()) return res.status(400).json({ message: "Name is required" });
        if (!EMAIL_RE.test(email)) return res.status(400).json({ message: "Enter a valid email address" });
        if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }
        if (!ROLES.includes(role)) return res.status(400).json({ message: "Role must be admin, head or member" });

        // Rejected rather than dropped, so the admin is never left believing the
        // person is reachable on WhatsApp.
        const normalizedPhone = normalizePhone(phone);
        if (phone && !normalizedPhone) {
            return res.status(400).json({ message: "That does not look like a valid mobile number" });
        }

        const memberships = [];
        if (department) {
            if (!mongoose.isValidObjectId(department) || !(await Department.exists({ _id: department }))) {
                return res.status(404).json({ message: "Department not found" });
            }
            const refused = await membershipError({ role }, department, Boolean(head));
            if (refused) return res.status(refused.status).json({ message: refused.message });
            memberships.push({ department, head: Boolean(head) });
        }

        // Emails from signup were never lowercased, so match case-insensitively.
        const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (await User.exists({ email: new RegExp(`^${escaped}$`, "i") })) {
            return res.status(409).json({ message: "A user with that email already exists" });
        }

        const user = await User.create({
            name: name.trim(),
            email,
            password: await bcrypt.hash(password, await bcrypt.genSalt(10)),
            phone: normalizedPhone,
            role,
            memberships,
        });

        res.status(201).json({
            message: `Created ${user.name} (${role})`,
            user: await User.findById(user._id).select("-password"),
        });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "A user with that email already exists" });
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// const deleteUser = async (req, res) => {
//     try {

//     } catch (error) {
//         res.status(500).json({ message: "Server error", error: error.message })

//     }
// }






module.exports = { getUser, getUserById, importMembers, createUser }