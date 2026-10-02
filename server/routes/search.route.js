const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { search } = require('../controller/search.controller.js');

router.get('/', protect, search);

module.exports = router;
