const jwt = require('jsonwebtoken');
const User = require('../model/user.model.js')


const protect = async (req, res, next) => {
    try {
        let token = req.headers.authorization;

        if (!token || !token.startsWith("Bearer")) {
            return res.status(401).json({ message: "Not authorized, no token" });
        }

        token = token.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select("-password");

        // A correctly signed token can still name a user that no longer exists.
        // Without this guard req.user is null and every route downstream throws a 500.
        if (!user) {
            return res.status(401).json({ message: "Not authorized, user no longer exists" });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ message: "Not authorized, token failed", error: error.message });
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


module.exports = { adminOnly, allowRoles, protect }
