const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../model/user.model.js");
const { normalizePhone } = require("../utils/phone.js");
const { modulesFor } = require("../utils/scope.js");
const { MIN_PASSWORD_LENGTH } = require("../utils/csv.js");
const { setAuthCookie, clearAuthCookie } = require("../utils/cookies.js");

// Generate JWT Token
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "2d" });
};

// The web app lives on the HttpOnly cookie; the same token is returned in the
// body for mobile, which has no cookie jar.
const issueToken = (res, userId) => {
    const token = generateToken(userId);
    setAuthCookie(res, token);
    return token;
};

// Only our own authenticated file URLs may be stored as an avatar.
const isOwnFileUrl = (url) => /^\/api\/files\/[0-9a-f]{24}(\/[^/]+)?$/.test(url || "");

// ponytail: in-memory, per process - fine for one server; move to Redis if scaled out.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const isThrottled = (key) => {
    const entry = failures.get(key);
    if (entry && entry.resetAt < Date.now()) failures.delete(key);
    return (failures.get(key)?.count || 0) >= MAX_FAILURES;
};
const recordFailure = (key) => {
    // Bounded: a flood of made-up emails must not grow this map without limit.
    if (failures.size > 10000) for (const [k, v] of failures) if (v.resetAt < Date.now()) failures.delete(k);
    if (failures.size > 10000) failures.clear();
    const entry = failures.get(key);
    if (!entry || entry.resetAt < Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
    else entry.count += 1;
};

// Register User
const registerUser = async (req, res) => {
    try {
        const { name, password, phone, adminInviteToken } = req.body;
        // Strings only: an object here ({"$ne": null}) would reach the query as an operator.
        const email = req.body.email;
        if (typeof email !== "string" || typeof name !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Name, email and password are required" });
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        }

        // Accounts are made by an admin (Team page). Open signup is opt-in; the
        // very first account bootstraps the deployment as its admin.
        const bootstrap = (await User.estimatedDocumentCount()) === 0;
        const invited = typeof adminInviteToken === "string" && adminInviteToken !== "" &&
            [process.env.ADMIN_INVITE_TOKEN, process.env.HEAD_INVITE_TOKEN].includes(adminInviteToken);
        if (!bootstrap && !invited && process.env.ALLOW_SIGNUP !== "true") {
            return res.status(403).json({ message: "Sign-up is closed. Ask an admin to create your account." });
        }

        // Check if user exists
        const userExist = await User.findOne({ email });
        if (userExist) {
            return res.status(400).json({ message: "User already exists" });
        }

        // Role assignment with invite token validation. The same form field carries
        // either token; an unset env var must never match an empty submission.
        let role = bootstrap ? "admin" : "member";
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
            role,
        });

        // Return user details and token
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            modules: await modulesFor(user),
            phone: user.phone,
            profileImageUrl: user.profileImageUrl,
            token: issueToken(res, user._id),
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
        // Strings only: an object email would reach findOne as a query operator.
        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // Throttle guessing: 10 failures per IP+email per 15 minutes.
        const throttleKey = `${req.ip}|${email.toLowerCase()}`;
        if (isThrottled(throttleKey)) {
            return res.status(429).json({ message: "Too many failed attempts. Try again in a few minutes." });
        }

        const user = await User.findOne({ email });
        if (!user) {
            recordFailure(throttleKey);
            return res.status(401).json({ message: "Invalid email or password" })
        };


        // compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            recordFailure(throttleKey);
            return res.status(401).json({ message: "Invalid email or password" })
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            modules: await modulesFor(user),
            phone: user.phone,
            profileImageUrl: user.profileImageUrl,
            token: issueToken(res, user._id)
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
        // The client gates its nav and routes on this, so the rule has exactly
        // one implementation and it lives on the server.
        res.json({ ...user.toObject(), modules: await modulesFor(user) });
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

        const { name, email, phone, profileImageUrl, password, currentPassword } = req.body;

        if (name) user.name = name;
        if (email) user.email = email;
        if (isOwnFileUrl(profileImageUrl)) user.profileImageUrl = profileImageUrl;

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
            // Proving the current password stops a stolen session token from
            // locking the real owner out of their account.
            if (!currentPassword) {
                return res.status(400).json({ message: "Enter your current password to set a new one" });
            }
            if (!(await bcrypt.compare(currentPassword, user.password))) {
                // 400, not 401: the client treats any 401 as an expired session and logs out.
                return res.status(400).json({ message: "Current password is incorrect" });
            }
            if (password.length < MIN_PASSWORD_LENGTH) {
                return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
            }
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            modules: await modulesFor(user),
            phone: user.phone,
            profileImageUrl: user.profileImageUrl,
            token: issueToken(res, user._id)
        });
    } catch (error) {
        console.error("Error while updating user profile:", error.message);
        res.status(500).json({ message: "Server error", error: error.message });
    }
};



// Logout
const logoutUser = (req, res) => {
    clearAuthCookie(res);
    res.json({ message: "Logged out" });
};

module.exports = {
    logoutUser,
    getUserProfile,
    registerUser,
    loginUser,
    updateUserProfile,
};