const mongoose = require('mongoose');

// A named set of task-list filters, private to one person.
// `filters` is the UI's filter object (priority, tag, "due this week"...); the controller
// whitelists the keys, so this stays a plain bag of short strings/booleans.
const savedFilterSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
},
{
    timestamps: true
});

savedFilterSchema.index({ user: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("SavedFilter", savedFilterSchema);
