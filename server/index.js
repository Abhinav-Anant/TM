const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const connection = require("./configue/db.js"); // Ensure this is the correct path to your DB configuration
const { startReminders } = require("./utils/reminders.js");
const { mailEnabled } = require("./utils/mailer.js");

// Route imports
const authRoutes = require('./routes/auth.route.js');
const userRoutes = require('./routes/user.route.js');
const taskRoutes = require('./routes/task.route.js');
const reportsRoutes = require('./routes/reports.route.js');
const notificationRoutes = require('./routes/notification.route.js');
const departmentRoutes = require('./routes/department.route.js');

const app = express();

// Middleware
app.use(cors());

app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/departments', departmentRoutes);

// Serve static files from "uploads" directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend (for Single Page App, e.g., React)
app.use(express.static(path.join(__dirname, '../client/dist')));

// Unknown API routes must answer with JSON, not the SPA shell.
app.use('/api', (req, res) => {
    res.status(404).json({ message: "Route not found" });
});

// Catch-all route to handle frontend routing for single-page apps
app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../client/dist/index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error(err.stack);

    if (err instanceof multer.MulterError || /Unsupported file type/.test(err.message || "")) {
        return res.status(400).json({ message: err.message });
    }

    if (process.env.NODE_ENV === 'development') {
        res.status(500).json({ message: err.message, stack: err.stack });
    } else {
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    try {
        await connection;
        console.log(`Server is running on port ${PORT}`);
        console.log(`Email notifications: ${mailEnabled ? "enabled" : "disabled (set SMTP_HOST / SMTP_USER to enable)"}`);
        startReminders();
    } catch (error) {
        console.error("Database connection failed:", error);
    }
});
