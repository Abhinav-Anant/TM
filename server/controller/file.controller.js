const crypto = require('crypto');
const path = require('path');
const File = require('../model/file.model.js');
const User = require('../model/user.model.js');
const Task = require('../model/task.model.js');
const storage = require('../storage/index.js');
const { canAccessTask } = require('../utils/scope.js');
const { logActivity } = require('../utils/activity.js');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

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

const MAX_ATTACHMENTS = 20;
const FILE_URL_RE = /^\/api\/files\/([0-9a-f]{24})(\/[^/]*)?$/;

// POST /api/tasks/:id/attachments { urls: [...] }
// Anyone who can open the task may attach files, but only files THEY uploaded: attaching someone
// else's upload would hand it to everyone who can see the task.
const attachFiles = async (req, res) => {
    try {
        const task = mongoose.isValidObjectId(req.params.id) ? await Task.findById(req.params.id) : null;
        if (!task) return res.status(404).json({ message: "Task not found" });
        if (!await canAccessTask(req.user, task)) return res.status(403).json({ message: "Not authorized" });

        const urls = [...new Set(Array.isArray(req.body.urls) ? req.body.urls : [])];
        if (urls.length === 0) return res.status(400).json({ message: "Nothing to attach" });
        const ids = urls.map((u) => FILE_URL_RE.exec(String(u))?.[1]);
        if (ids.some((id) => !id)) return res.status(400).json({ message: "Only uploaded files can be attached" });

        const files = await File.find({ _id: { $in: ids }, kind: "attachment" });
        const mine = files.filter((f) => req.user.role === "admin" || String(f.uploadedBy) === String(req.user._id));
        if (mine.length !== ids.length) return res.status(400).json({ message: "You can only attach files you uploaded" });

        const fresh = urls.filter((u) => !task.attachments.includes(u));
        if (task.attachments.length + fresh.length > MAX_ATTACHMENTS) {
            return res.status(400).json({ message: `A task can hold up to ${MAX_ATTACHMENTS} attachments` });
        }
        if (fresh.length) {
            task.attachments.push(...fresh);
            logActivity(task, req.user, "attachment", fresh.length === 1 ? "added an attachment" : `added ${fresh.length} attachments`);
            await task.save();
        }
        res.json({ attachments: task.attachments });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// GET /api/files/:id/link - a 5-minute, single-file URL. A phone cannot send an Authorization header
// from a browser or image viewer, so this is how the app opens a file without putting its real token in a URL.
const LINK_SECONDS = 5 * 60;
const getFileLink = async (req, res) => {
    try {
        const file = mongoose.isValidObjectId(req.params.id) ? await File.findById(req.params.id) : null;
        if (!file || !(await canReadFile(req.user, file))) return res.status(404).json({ message: "File not found" });
        const ft = jwt.sign({ purpose: "file", fid: String(file._id), uid: String(req.user._id) }, process.env.JWT_SECRET, { expiresIn: LINK_SECONDS });
        res.json({ url: `${fileUrl(file)}?ft=${ft}`, expiresIn: LINK_SECONDS });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
};

// Lets GET /api/files/:id through on a valid link token, acting as the person who asked for the link.
// The token only works for the one file it names; a normal session token has no `purpose`, so it never qualifies.
const fileLinkAuth = async (req, res, next) => {
    try {
        const payload = jwt.verify(String(req.query.ft), process.env.JWT_SECRET);
        if (payload.purpose !== "file" || payload.fid !== req.params.id) throw new Error("wrong file");
        const user = await User.findById(payload.uid).select("-password");
        if (!user) throw new Error("no user");
        req.user = user;
        next();
    } catch {
        res.status(401).json({ message: "This link has expired" });
    }
};

module.exports = { uploadAttachments, uploadProfileImage, getFile, fileUrl, attachFiles, getFileLink, fileLinkAuth };
