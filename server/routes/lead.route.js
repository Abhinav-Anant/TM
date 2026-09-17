const express = require("express");
const router = express.Router();
const { protect, adminOnly, requireModule } = require('../middleware/authMiddleware.js');
const {
    listLeads, createLead, getPipeline, getLeadById,
    updateLead, updateLeadStage, logOutcome, deleteLead,
} = require('../controller/lead.controller.js');

// Which department grants which screen - see Department.modules.
const sales = requireModule('sales');
const leads = requireModule('leads');

// Static paths must stay above '/:id' or Express matches them as a lead id.
// The dashboard is the only 'sales' endpoint; everything else is 'leads'.
router.get('/pipeline', protect, sales, getPipeline);

router.get('/', protect, leads, listLeads);
// Anyone whose department grants leads may log one - a rep who takes a call
// must be able to record it. Ownership rules live in the controller.
router.post('/', protect, leads, createLead);

router.put('/:id/stage', protect, leads, updateLeadStage);
router.post('/:id/outcome', protect, leads, logOutcome);

router.get('/:id', protect, leads, getLeadById);
router.put('/:id', protect, leads, updateLead);
router.delete('/:id', protect, leads, adminOnly, deleteLead);

module.exports = router;
