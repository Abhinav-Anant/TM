const mongoose = require('mongoose');
const { RECURRENCES } = require('../utils/recurrence.js');
const { STATUSES, PRIORITIES } = require('../utils/taskStatus.js');

const todoSchema = new mongoose.Schema({
    text: { type: String, required: true }, 
    completed: { type: Boolean, default: false }, 
});

// Deliberately small: a subtask is a titled line with an owner, a state and a date.
// Embedded (not separate tasks) so it never pollutes task lists, counts or scoping.
const subtaskSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 200 },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ['To Do', 'In Progress', 'Completed'], default: 'To Do' },
    dueDate: { type: Date, default: null },
});

const activitySchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, required: true },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
}, { _id: false });

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
        enum: PRIORITIES, 
        default: 'Medium' 
    },
    status: {
        type: String,
        enum: STATUSES,
        default: 'To Do'
    },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    tags: { type: [String], default: [] },
    // People who asked to hear about changes, on top of assignees and creator.
    watchers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    // "Blocked by": tasks that must finish (or be cancelled) before this one can start.
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    subtasks: [subtaskSchema],
    activity: [activitySchema],
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
taskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
taskSchema.index({ createdAt: -1 });
taskSchema.index({ category: 1 });
taskSchema.index({ tags: 1 });
taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ department: 1 });
taskSchema.index({ watchers: 1 });
taskSchema.index({ blockedBy: 1 });

const Task = mongoose.model("Task", taskSchema);

module.exports = Task;
