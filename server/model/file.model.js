const mongoose = require('mongoose');

// One row per uploaded blob. The bytes live in the storage driver under `key`;
// access is decided here, never by the URL.
const fileSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // 'avatar' files are readable by any signed-in user; 'attachment' files only
    // by their uploader or someone who can open a task that references them.
    kind: { type: String, enum: ['avatar', 'attachment'], default: 'attachment' },
},
{
    timestamps: true
});

module.exports = mongoose.model("File", fileSchema);
