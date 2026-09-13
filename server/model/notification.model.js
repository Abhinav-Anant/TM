const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    type: {
        type: String,
        enum: ['assigned', 'updated', 'status', 'comment', 'deadline', 'overdue'],
        required: true,
    },
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
