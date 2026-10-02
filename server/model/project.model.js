const mongoose = require('mongoose');
const { PRIORITIES } = require('../utils/taskStatus.js');

const PROJECT_STATUSES = ['Planning', 'Active', 'On Hold', 'Completed', 'Cancelled'];

const projectSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 5000 },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: 'Planning' },
    priority: { type: String, enum: PRIORITIES, default: 'Medium' },
    tags: { type: [String], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
},
{
    timestamps: true
});

projectSchema.index({ status: 1, createdAt: -1 });
projectSchema.index({ department: 1 });
projectSchema.index({ members: 1 });
projectSchema.index({ manager: 1 });

const Project = mongoose.model("Project", projectSchema);

module.exports = Project;
module.exports.PROJECT_STATUSES = PROJECT_STATUSES;
