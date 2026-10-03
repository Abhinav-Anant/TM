const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    type: {
        type: String,
        enum: ['assigned', 'reassigned', 'mention', 'updated', 'status', 'comment', 'deadline', 'overdue', 'review', 'approved', 'completed', 'blocked', 'escalation'],
        required: true,
    },
    // The preference key this was sent under (a 'deadline' is due_today or due_tomorrow).
    event: { type: String, default: null },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    read: { type: Boolean, default: false },
},
{
    timestamps: true
});

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ task: 1, type: 1 });

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
