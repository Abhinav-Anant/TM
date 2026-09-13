const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Must match the folder index.js serves at /uploads, regardless of the cwd the server was started from.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Strip directory components so a crafted filename cannot escape the upload folder.
        const safeName = path.basename(file.originalname).replace(/[^\w.\- ]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
    },
});

const makeFilter = (allowedTypes) => (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
};

const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];

const ATTACHMENT_TYPES = [
    ...IMAGE_TYPES,
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

const upload = multer({
    storage,
    fileFilter: makeFilter(IMAGE_TYPES),
    limits: { fileSize: 5 * 1024 * 1024 },
});

const fileUpload = multer({
    storage,
    fileFilter: makeFilter(ATTACHMENT_TYPES),
    limits: { fileSize: 15 * 1024 * 1024, files: 5 },
});

module.exports = upload;
module.exports.upload = upload;
module.exports.fileUpload = fileUpload;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
