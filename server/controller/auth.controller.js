const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../model/user.model.js");
const { normalizePhone } = require("../utils/phone.js");

// Generate JWT Token
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "2d" });
};

// Register User
const registerUser = async (req, res) => {
    try {
        const { name, email, password, phone, profileImageUrl, adminInviteToken } = req.body;

        // Check if user exists
        const userExist = await User.findOne({ email });
        if (userExist) {
            return res.status(400).json({ message: "User already exists" });
        }

        // Role assignment with invite token validation. The same form field carries
        // either token; an unset env var must never match an empty submission.
        let role = "member";
        if (adminInviteToken && adminInviteToken === process.env.ADMIN_INVITE_TOKEN) {
            role = "admin";
        } else if (adminInviteToken && adminInviteToken === process.env.HEAD_INVITE_TOKEN) {
            // A head starts with no department; an admin assigns them to one.
            role = "head";
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create the new user
        // Optional at signup - members who skip it are prompted in the portal
        // until they add one. A number we cannot normalise is dropped rather
        // than stored, so a bad value never reaches the WhatsApp gateway.
        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            phone: normalizePhone(phone),
            profileImageUrl,
            role,
        });

        // Return user details and token
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            profileImageUrl: user.profileImageUrl,
            token: generateToken(user._id),
        });
    } catch (error) {
        console.error("Error while registering user:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Login User 
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;


        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: "Invalid email or password" })
        };


        // compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid email or password" })
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            profileImageUrl: user.profileImageUrl,
            token: generateToken(user._id)
        })


    } catch (error) {
        console.error("Error while logging in:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Get User Profile 
const getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.json(user);
    } catch (error) {
        console.error("Error while retrieving user profile:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Update User Profile 
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const { name, email, phone, profileImageUrl, password } = req.body;

        if (name) user.name = name;
        if (email) user.email = email;
        if (profileImageUrl) user.profileImageUrl = profileImageUrl;

        // Rejecting loudly matters here: silently discarding a typo'd number
        // would leave the member believing they are reachable on WhatsApp when
        // nothing will ever be delivered to them.
        if (phone !== undefined) {
            const normalized = normalizePhone(phone);
            if (phone !== "" && phone !== null && !normalized) {
                return res.status(400).json({ message: "That does not look like a valid mobile number" });
            }
            user.phone = normalized;
        }
        if (password) {
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            profileImageUrl: user.profileImageUrl,
            token:generateToken(user._id)
        });
    } catch (error) {
        console.error("Error while updating user profile:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};



module.exports = {
    getUserProfile,
    registerUser,
    loginUser,
    updateUserProfile,
};