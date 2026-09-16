const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware.js');
const {
    listLeads, createLead, getPipeline, getLeadById,
    updateLead, updateLeadStage, logOutcome, deleteLead,
} = require('../controller/lead.controller.js');

// Static paths must stay above '/:id' or Express matches them as a lead id.
router.get('/pipeline', protect, getPipeline);

router.get('/', protect, listLeads);
// Anyone signed in may log a lead - a rep who takes a call must be able to
// record it. Ownership rules live in the controller.
router.post('/', protect, createLead);

router.put('/:id/stage', protect, updateLeadStage);
router.post('/:id/outcome', protect, logOutcome);

router.get('/:id', protect, getLeadById);
router.put('/:id', protect, updateLead);
router.delete('/:id', protect, adminOnly, deleteLead);

module.exports = router;
