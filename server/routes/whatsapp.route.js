const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware.js');
const { getMyLink, startLink, pairWithCode, unlink, listAccounts, sendMessage } = require('../controller/whatsapp.controller.js');

router.get('/me', protect, getMyLink);
router.post('/me/link', protect, startLink);
router.post('/me/pair', protect, pairWithCode);
router.post('/me/unlink', protect, unlink);
router.get('/accounts', protect, adminOnly, listAccounts);
router.post('/send', protect, adminOnly, sendMessage);

module.exports = router;
