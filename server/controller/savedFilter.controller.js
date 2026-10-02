const mongoose = require('mongoose');
const SavedFilter = require('../model/savedFilter.model.js');

const MAX_PER_USER = 20;

// What the task-list UI can filter by. Anything else is dropped, so a saved filter
// can never smuggle arbitrary query parameters into the list request.
const ALLOWED_KEYS = [
    'search', 'priority', 'category', 'tag', 'project', 'department', 'assignee',
    'duePreset', 'overdue', 'mine', 'sort',
];

/** Keeps allowed keys with short string / boolean values, and drops empty ones. */
const cleanFilters = (input) => {
    const out = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const key of ALLOWED_KEYS) {
        const value = input[key];
        if (typeof value === 'boolean') { if (value) out[key] = true; }
        else if (typeof value === 'string' && value.trim() && value.length <= 100) out[key] = value.trim();
    }
    return out;
};

const fail = (res, error) => res.status(500).json({ message: "Server error", error: error.message });

const listSavedFilters = async (req, res) => {
    try {
        res.json({ filters: await SavedFilter.find({ user: req.user._id }).sort({ name: 1 }).lean() });
    } catch (error) { fail(res, error); }
};

const createSavedFilter = async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        if (!name || name.length > 60) return res.status(400).json({ message: "Give the filter a name (up to 60 characters)" });
        const filters = cleanFilters(req.body.filters);
        if (Object.keys(filters).length === 0) return res.status(400).json({ message: "Set at least one filter before saving" });
        if ((await SavedFilter.countDocuments({ user: req.user._id })) >= MAX_PER_USER) {
            return res.status(400).json({ message: `You can save up to ${MAX_PER_USER} filters` });
        }
        const saved = await SavedFilter.create({ user: req.user._id, name, filters });
        res.status(201).json({ filter: saved });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "You already have a filter with that name" });
        fail(res, error);
    }
};

const deleteSavedFilter = async (req, res) => {
    try {
        // Scoped by user: someone else's id is simply "not found".
        const removed = mongoose.isValidObjectId(req.params.id)
            ? await SavedFilter.findOneAndDelete({ _id: req.params.id, user: req.user._id })
            : null;
        if (!removed) return res.status(404).json({ message: "Saved filter not found" });
        res.json({ message: "Filter deleted" });
    } catch (error) { fail(res, error); }
};

module.exports = { listSavedFilters, createSavedFilter, deleteSavedFilter, cleanFilters };
