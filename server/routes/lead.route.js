const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { createLead, listLeads } = require('../controller/lead.controller.js');

router.get('/', protect, listLeads);
// Anyone signed in may log a lead - a rep who takes a call must be able to
// record it. Ownership rules live in the controller.
router.post('/', protect, createLead);

module.exports = router;
