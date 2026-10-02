const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { getFile } = require('../controller/file.controller.js');

router.get('/:id/:name?', protect, getFile);

module.exports = router;
