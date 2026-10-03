const express = require("express");
const router = express.Router();
const { protect } = require('../middleware/authMiddleware.js');
const {
    getPreferences,
    updatePreferences,
    registerPushToken,
    removePushToken,
    getNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    stream,
} = require('../controller/notification.controller.js');

router.get('/stream', protect, stream);
router.get('/preferences', protect, getPreferences);
router.put('/preferences', protect, updatePreferences);
router.post('/push-token', protect, registerPushToken);
router.delete('/push-token', protect, removePushToken);
router.get('/', protect, getNotifications);
router.put('/read-all', protect, markAllAsRead);
router.put('/:id/read', protect, markAsRead);
router.delete('/:id', protect, deleteNotification);

module.exports = router;
