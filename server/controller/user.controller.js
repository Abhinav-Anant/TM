const express = require("express");
const Task = require('../model/task.model.js')
const User = require('../model/user.model.js')
const bcrypt = require("bcryptjs");
const { departmentMemberIds } = require('../utils/scope.js');


const getUser = async (req, res) => {
    try {
        // Admins may assign to anyone (members and heads alike); a head only ever
        // sees the people in their own department.
        const filter = req.user.role === "head"
            ? { _id: { $in: await departmentMemberIds(req.user.department) } }
            : { role: { $in: ["member", "head"] } };

        const users = await User.find(filter)
            .select("-password")
            .populate("department", "name");

        const usersWithTaskCounts = [];
        for (const user of users) {
            const pendingTasks = await Task.countDocuments({ assignedTo: user._id, status: "Pending" });
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
                ? (await departmentMemberIds(req.user.department)).map(String)
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

// const deleteUser = async (req, res) => {
//     try {

//     } catch (error) {
//         res.status(500).json({ message: "Server error", error: error.message })

//     }
// }






module.exports = { getUser, getUserById, }