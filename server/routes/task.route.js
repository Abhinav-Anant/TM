const express = require("express");
const router = express.Router();
const { protect, adminOnly, allowRoles } = require('../middleware/authMiddleware.js');
const { fileUpload } = require('../middleware/uploadMiddleware.js');
const { uploadAttachments } = require('../controller/file.controller.js');
const {
    getDashboardData, getUserDashboardData,
    getTasks, getTaskById, getCategories, getAnalytics,
    createTask, updateTask,
    updateTaskCheckList, updateTaskStatus, reviewTask,
    addComment, deleteComment,
    deleteTask,
} = require('../controller/task.controller.js');

// Static paths must stay above '/:id' or Express matches them as a task id.
router.get('/dashboard-data', protect, getDashboardData);
router.get('/user-dashboard-data', protect, getUserDashboardData);
router.get('/analytics', protect, getAnalytics);
router.get('/categories', protect, getCategories);
router.post('/upload', protect, fileUpload.array('files', 5), uploadAttachments);

router.get('/', protect, getTasks);
router.get('/:id', protect, getTaskById);
router.post('/', protect, allowRoles("admin", "head"), createTask);
// Heads may edit tasks in their department; members use /status and /todo instead.
router.put('/:id', protect, allowRoles("admin", "head"), updateTask);
router.put('/:id/todo', protect, updateTaskCheckList);
router.put('/:id/status', protect, updateTaskStatus);
router.put('/:id/review', protect, reviewTask);
router.delete('/:id', protect, adminOnly, deleteTask);

router.post('/:id/comments', protect, addComment);
router.delete('/:id/comments/:commentId', protect, deleteComment);

module.exports = router;
