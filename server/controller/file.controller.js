const crypto = require('crypto');
const path = require('path');
const File = require('../model/file.model.js');
const Task = require('../model/task.model.js');
const storage = require('../storage/index.js');
const { canAccessTask } = require('../utils/scope.js');

// The trailing name is cosmetic (clients show it as the link text); only :id is looked up.
const fileUrl = (file) => `/api/files/${file._id}/${encodeURIComponent(file.name)}`;

// Only these render in the browser; anything else is forced to download so an
// uploaded .html/.svg can never run script on our origin.
const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/** Stores multer memory files and returns their File rows. */
const saveFiles = async (files, user, kind) => {
    const saved = [];
    for (const f of files) {
        const ext = path.extname(path.basename(f.originalname)).replace(/[^\w.]/g, '');
        const key = `${crypto.randomUUID()}${ext}`;
        await storage.put(key, f.buffer, f.mimetype);
        saved.push(await File.create({
            key, name: path.basename(f.originalname), mimeType: f.mimetype,
            size: f.size, uploadedBy: user._id, kind,
        }));
    }
    return saved;
};

// POST /api/tasks/upload - returns URLs the client stores in task.attachments.
const uploadAttachments = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: "No files uploaded" });
        }
        const saved = await saveFiles(req.files, req.user, 'attachment');
        const files = saved.map((f) => ({ name: f.name, size: f.size, url: fileUrl(f) }));
        res.status(200).json({ files, urls: files.map((f) => f.url) });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// POST /api/auth/upload-image
const uploadProfileImage = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No file uploaded" });
        const [file] = await saveFiles([req.file], req.user, 'avatar');
        res.status(200).json({ imageUrl: fileUrl(file) });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

/** May `user` read this file? Same rule as the task that references it. */
const canReadFile = async (user, file) => {
    if (file.kind === 'avatar' || user.role === 'admin') return true;
    if (String(file.uploadedBy) === String(user._id)) return true;

    const tasks = await Task.find({ attachments: fileUrl(file) }).select('assignedTo');
    for (const task of tasks) {
        if (await canAccessTask(user, task)) return true;
    }
    return false;
};

// GET /api/files/:id
const getFile = async (req, res) => {
    try {
        const file = await File.findById(req.params.id).catch(() => null);
        // 404 for "not yours" too, so a response never confirms a file exists.
        if (!file || !(await canReadFile(req.user, file))) {
            return res.status(404).json({ message: "File not found" });
        }

        const stream = await storage.get(file.key);
        stream.on('error', () => res.headersSent ? res.end() : res.status(404).json({ message: "File not found" }));

        const inline = INLINE_TYPES.includes(file.mimeType);
        res.set({
            'Content-Type': inline ? file.mimeType : 'application/octet-stream',
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=3600',
        });
        stream.pipe(res);
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

module.exports = { uploadAttachments, uploadProfileImage, getFile, fileUrl };
