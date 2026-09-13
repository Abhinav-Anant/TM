const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const {
    getNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    stream,
} = require('../controller/notification.controller.js');

router.get('/stream', protect, stream);
router.get('/', protect, getNotifications);
router.put('/read-all', protect, markAllAsRead);
router.put('/:id/read', protect, markAsRead);
router.delete('/:id', protect, deleteNotification);

module.exports = router;
