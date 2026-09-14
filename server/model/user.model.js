const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    profileImageUrl: { type: String, default: null },
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