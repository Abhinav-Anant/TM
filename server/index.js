const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const connection = require("./configue/db.js"); // Ensure this is the correct path to your DB configuration
const { startReminders } = require("./utils/reminders.js");
const { startWorker } = require("./utils/jobs.js");
const { emailEnabled } = require("./utils/email.js");
const { whatsappEnabled } = require("./utils/whatsapp.js");

// Route imports
const authRoutes = require('./routes/auth.route.js');
const userRoutes = require('./routes/user.route.js');
const taskRoutes = require('./routes/task.route.js');
const reportsRoutes = require('./routes/reports.route.js');
const notificationRoutes = require('./routes/notification.route.js');
const departmentRoutes = require('./routes/department.route.js');
const leadRoutes = require('./routes/lead.route.js');
const fileRoutes = require('./routes/file.route.js');
const projectRoutes = require('./routes/project.route.js');
const searchRoutes = require('./routes/search.route.js');
const calendarRoutes = require('./routes/calendar.route.js');
const savedFilterRoutes = require('./routes/savedFilter.route.js');
const whatsappRoutes = require('./routes/whatsapp.route.js');

const app = express();
// Behind a local reverse proxy (nginx), take the client IP from X-Forwarded-For so the
// login throttle keys on the real address. Only a proxy on this machine is trusted.
app.set('trust proxy', 'loopback');

if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not set - refusing to start.");
    process.exit(1);
}

// Middleware
// The web app is served from this same origin, so CORS is only needed for other
// origins (a separate dev server, a hosted client): list them in CORS_ORIGINS.
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/saved-filters', savedFilterRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Uploads are NOT served statically: /api/files/:id checks who is asking.

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
        // Task status "Pending" was renamed "To Do"; idempotent, so safe on every boot.
        await require("./model/task.model.js").collection.updateMany({ status: "Pending" }, { $set: { status: "To Do" } });
        console.log(`Server is running on port ${PORT}`);
        console.log(`Email notifications: ${emailEnabled ? "enabled" : "disabled (set SMTP_HOST / SMTP_FROM to enable)"}`);
        console.log(`WhatsApp notifications: ${whatsappEnabled ? "enabled" : "disabled (set BLASTUP_URL to enable)"}`);
        startWorker();
        startReminders();
    } catch (error) {
        console.error("Database connection failed:", error);
    }
});
