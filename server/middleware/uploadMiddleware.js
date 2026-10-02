const multer = require('multer');
const path = require('path');

// Bytes are buffered, then handed to the storage driver (local disk or S3) by controller/file.controller.js.
const storage = multer.memoryStorage();

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

// CSV import is parsed in-process and thrown away - never write it to the uploads folder.
// Extension, not mimetype: browsers label .csv as text/csv, application/vnd.ms-excel or octet-stream.
const csvUpload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() === '.csv') return cb(null, true);
        cb(new Error('Unsupported file type: expected a .csv file'), false);
    },
    limits: { fileSize: 1024 * 1024, files: 1 },
});

module.exports = upload;
module.exports.upload = upload;
module.exports.fileUpload = fileUpload;
module.exports.csvUpload = csvUpload;
