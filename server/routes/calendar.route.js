const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { getCalendar } = require('../controller/calendar.controller.js');

router.get('/', protect, getCalendar);

module.exports = router;
