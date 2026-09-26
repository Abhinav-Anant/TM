const mongoose = require('mongoose');
const { RECURRENCES } = require('../utils/recurrence.js');

const todoSchema = new mongoose.Schema({
    text: { type: String, required: true }, 
    completed: { type: Boolean, default: false }, 
});

const commentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
},
{
    timestamps: true
});

const taskSchema = new mongoose.Schema({
    title: { type: String, required: true }, 
    description: { type: String },
    category: { type: String, default: 'General', trim: true },
    priority: { 
        type: String, 
        enum: ['Low', 'High', 'Medium'], 
        default: 'Medium' 
    },
    status: {
        type: String,
        enum: ['Pending', 'In Progress', 'In Review', 'Completed'],
        default: 'Pending'
    },
    dueDate: { type: Date, required: true }, 
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], 
    createdBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    attachments: [{ type: String }], 
    todoChecklist: [todoSchema], 
    comments: [commentSchema],
    progress: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    // Off by default so tasks created before the review step behave as before;
    // the web form opts new tasks in.
    requiresReview: { type: Boolean, default: false },
    recurrence: { type: String, enum: RECURRENCES, default: 'none' },
    // The copy spawned when this one completed. Doubles as the "already spawned"
    // guard, so reopening and re-completing never creates a second copy.
    nextTask: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    // Set when this task is a sales follow-up. The only link between the task
    // system and the pipeline - they share a database, so there is nothing to sync.
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
},
{
    timestamps: true 
});

taskSchema.index({ dueDate: 1, status: 1 });
taskSchema.index({ assignedTo: 1 });
taskSchema.index({ category: 1 });

const Task = mongoose.model("Task", taskSchema);

module.exports = Task;
