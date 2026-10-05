const mongoose = require('mongoose');

// A person can sit in several departments; `head` marks the ones they lead.
// Headship lives here rather than being derived from `role`, so joining a
// second department as a rep cannot make you its head.
const membershipSchema = new mongoose.Schema({
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", required: true },
    head: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profileImageUrl: { type: String, default: null },
    // Bare international form, digits only (919876543210) - the shape the
    // WhatsApp gateway expects. Normalised on the way in by utils/phone.js so
    // the send path never has to guess. Null means alerts stay in-app only.
    phone: { type: String, default: null },
    role: { type: String, enum: ["admin", "head", "member"], default: "member" },
    memberships: { type: [membershipSchema], default: [] },
    // Overrides only - see utils/notificationPrefs.js for the defaults and the shape.
    notificationPrefs: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Expo push tokens, one per signed-in device.
    pushTokens: { type: [String], default: [] },
    // Their own WhatsApp linked through the gateway (utils/whatsapp.js): the gateway API key, encrypted,
    // and the number it is connected as. waPhone null = not linked, alerts fall back to the company number.
    waKey: { type: String, default: null, select: false },
    waPhone: { type: String, default: null },
},
{
    timestamps: true 
});


// Nearly every scoped query filters on this, so it is not optional.
userSchema.index({ 'memberships.department': 1 });

const User = mongoose.model("User", userSchema);

module.exports = User;