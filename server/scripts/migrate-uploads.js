/**
 * One-off: bring files uploaded before /api/files existed under access control.
 * Rewrites legacy ".../uploads/<name>" URLs on users (avatars) and tasks
 * (attachments) to /api/files/:id and records a File row for each.
 * Idempotent. Run: node server/scripts/migrate-uploads.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const File = require("../model/file.model.js");
const User = require("../model/user.model.js");
const Task = require("../model/task.model.js");
const storage = require("../storage/index.js");
const { fileUrl } = require("../controller/file.controller.js");

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv" };
const LEGACY = /^(?:https?:\/\/[^/]+)?\/uploads\/([^/?#]+)$/;

// Returns the new URL, or null if the url is not a legacy upload / the file is gone.
const convert = async (url, uploadedBy, kind) => {
    const match = LEGACY.exec(url || "");
    if (!match) return null;
    const name = decodeURIComponent(match[1]);
    const disk = path.join(storage.UPLOAD_DIR, path.basename(name));
    if (!fs.existsSync(disk)) return null;

    let file = await File.findOne({ key: name });
    if (!file) {
        const buffer = fs.readFileSync(disk);
        await storage.put(name, buffer, MIME[path.extname(name).toLowerCase()] || "application/octet-stream");
        file = await File.create({
            key: name, name: name.replace(/^\d{10,}-/, ""), size: buffer.length, uploadedBy, kind,
            mimeType: MIME[path.extname(name).toLowerCase()] || "application/octet-stream",
        });
    }
    return fileUrl(file);
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    let moved = 0;

    for (const user of await User.find({ profileImageUrl: /\/uploads\// })) {
        const next = await convert(user.profileImageUrl, user._id, "avatar");
        if (next) { user.profileImageUrl = next; await user.save(); moved += 1; }
    }

    for (const task of await Task.find({ attachments: /\/uploads\// })) {
        const owner = task.createdBy?.[0] || task.assignedTo?.[0];
        const attachments = [];
        for (const url of task.attachments) attachments.push((owner && await convert(url, owner, "attachment")) || url);
        await Task.updateOne({ _id: task._id }, { attachments });
        moved += 1;
    }

    console.log(`Migrated ${moved} record(s).`);
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
