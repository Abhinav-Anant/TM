const mongoose = require('mongoose');

// The pipeline, in order. Everything past Negotiation is closed.
const STAGES = ['New', 'Contacted', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Won', 'Lost'];

const SOURCES = [
    'Website', 'WhatsApp', 'Inbound Call', 'Existing Customer', 'Referral',
    'Google', 'Facebook', 'Partner', 'Salesperson', 'Other',
];

const PRODUCTS = [
    'Internet', 'Firewall', 'LeoPrime', 'SD-WAN', 'Hotspot',
    'VPS', 'CCTV', 'Cloud', 'Other',
];

// Append-only. Stored rather than derived: rebuilding the history panel from
// stage diffs plus task records is more code than writing one line per change.
const historySchema = new mongoose.Schema({
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
}, { _id: false });

const leadSchema = new mongoose.Schema({
    company: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: "" },
    // Bare international form, digits only - the same shape User.phone holds,
    // normalised on the way in by utils/phone.js.
    phone: { type: String, default: null },
    email: { type: String, trim: true, lowercase: true, default: "" },
    source: { type: String, enum: SOURCES, default: 'Other' },
    product: { type: String, enum: PRODUCTS, default: 'Other' },
    // Plain rupees. The client is the only thing that formats this as lakhs.
    value: { type: Number, default: 0 },
    stage: { type: String, enum: STAGES, default: 'New' },
    // One owner, not an array - a lead belongs to exactly one salesperson.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lostReason: { type: String, default: null },
    closedAt: { type: Date, default: null },
    history: [historySchema],
},
{
    timestamps: true
});

// Serves both the scoped list and the pipeline aggregation.
leadSchema.index({ owner: 1, stage: 1 });
leadSchema.index({ createdAt: -1 });

const Lead = mongoose.model("Lead", leadSchema);

module.exports = Lead;
