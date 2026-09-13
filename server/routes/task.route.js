const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require('../middleware/authMiddleware.js');
const { fileUpload } = require('../middleware/uploadMiddleware.js');
const {
    getDashboardData, getUserDashboardData,
    getTasks, getTaskById, getCategories, getAnalytics,
    createTask, updateTask,
    updateTaskCheckList, updateTaskStatus,
    addComment, deleteComment, uploadAttachments,
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
router.post('/', protect, adminOnly, createTask);
router.put('/:id', protect, updateTask);
router.put('/:id/todo', protect, updateTaskCheckList);
router.put('/:id/status', protect, updateTaskStatus);
router.delete('/:id', protect, adminOnly, deleteTask);

router.post('/:id/comments', protect, addComment);
router.delete('/:id/comments/:commentId', protect, deleteComment);

module.exports = router;
