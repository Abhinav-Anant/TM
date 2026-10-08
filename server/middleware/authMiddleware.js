const jwt = require('jsonwebtoken');
const User = require('../model/user.model.js')
const { modulesFor } = require('../utils/scope.js');
const { AUTH_COOKIE, readCookie } = require('../utils/cookies.js');


const protect = async (req, res, next) => {
    try {
        const header = req.headers.authorization;
        // Mobile sends a Bearer token; the web app relies on the HttpOnly cookie.
        const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : readCookie(req, AUTH_COOKIE);

        if (!token) {
            return res.status(401).json({ message: "Not authorized, no token" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select("-password");

        // A correctly signed token can still name a user that no longer exists.
        // Without this guard req.user is null and every route downstream throws a 500.
        if (!user) {
            return res.status(401).json({ message: "Not authorized, user no longer exists" });
        }

        // Logout and password change bump tokenVersion; tokens from before that no longer count.
        if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
            return res.status(401).json({ message: "Not authorized, session ended" });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ message: "Not authorized, token failed" });
    }
}

// middleware only for admin access

const adminOnly = (req, res, next) => {
    if (req.user && req.user.role === "admin") {
        next();
    } else {
        res.status(403).json({ message: "Access denied, admin only" })

    }
}


// Gate a route on a set of roles, e.g. allowRoles("admin", "head").
const allowRoles = (...roles) => (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) {
        next();
    } else {
        res.status(403).json({ message: `Access denied, ${roles.join(" or ")} only` });
    }
}


/**
 * Gate a route on a module a department grants, e.g. requireModule("leads").
 *
 * 403, not the 404 used for out-of-scope records: that 404 exists so a response
 * cannot confirm a record's existence, and a module gate reveals nothing about
 * records. Must run after `protect` - it reads req.user.
 */
const requireModule = (name) => async (req, res, next) => {
    try {
        const modules = await modulesFor(req.user);
        if (!modules.includes(name)) {
            return res.status(403).json({
                message: `Access denied, ${name} is not enabled for your department`,
            });
        }
        next();
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}


module.exports = { adminOnly, allowRoles, protect, requireModule }
