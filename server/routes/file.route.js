const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { getFile, getFileLink, fileLinkAuth } = require('../controller/file.controller.js');

// Before /:id/:name?, or "link" would be read as a file name.
router.get('/:id/link', protect, getFileLink);
router.get('/:id/:name?', (req, res, next) => (req.query.ft ? fileLinkAuth(req, res, next) : protect(req, res, next)), getFile);

module.exports = router;
