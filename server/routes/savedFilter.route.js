const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const { listSavedFilters, createSavedFilter, deleteSavedFilter } = require('../controller/savedFilter.controller.js');

router.get('/', protect, listSavedFilters);
router.post('/', protect, createSavedFilter);
router.delete('/:id', protect, deleteSavedFilter);

module.exports = router;
