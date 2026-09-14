const mongoose = require('mongoose');

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
    // Single source of truth for department membership - a head is simply the
    // user in this department whose role is "head".
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
},
{
    timestamps: true 
});


const User = mongoose.model("User", userSchema);

module.exports = User;