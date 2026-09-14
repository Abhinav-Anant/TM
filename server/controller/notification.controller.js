const Notification = require('../model/notification.model.js');
const { addClient } = require('../utils/sse.js');

const HEARTBEAT_MS = 25000;

const getNotifications = async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 30, 100);
        const filter = { user: req.user._id };
        if (req.query.unread === "true") filter.read = false;

        const [notifications, unreadCount] = await Promise.all([
            Notification.find(filter)
                .sort({ createdAt: -1 })
                .limit(limit)
                .populate("task", "title status dueDate"),
            Notification.countDocuments({ user: req.user._id, read: false }),
        ]);

        res.json({ notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { read: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
        res.json({ notification, unreadCount });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const markAllAsRead = async (req, res) => {
    try {
        await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
        res.json({ message: "All notifications marked as read", unreadCount: 0 });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

const deleteNotification = async (req, res) => {
    try {
        const deleted = await Notification.findOneAndDelete({
            _id: req.params.id,
            user: req.user._id,
        });

        if (!deleted) {
            return res.status(404).json({ message: "Notification not found" });
        }

        // Deleting an unread notification changes the count - report it like
        // markAsRead does, so the client never has to guess.
        const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
        res.json({ message: "Notification deleted", unreadCount });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Live push channel. The client reads it with fetch() so the JWT stays in the
// Authorization header instead of a query string (EventSource cannot set headers).
const stream = (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

    const remove = addClient(req.user._id, res);
    const heartbeat = setInterval(() => {
        try {
            res.write(`data: ${JSON.stringify({ type: "ping" })}\n\n`);
        } catch (err) {
            clearInterval(heartbeat);
        }
    }, HEARTBEAT_MS);

    req.on("close", () => {
        clearInterval(heartbeat);
        remove();
    });
};

module.exports = {
    getNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    stream,
};
