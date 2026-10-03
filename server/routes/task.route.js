const express = require("express");
const router = express.Router();
const { protect, adminOnly, allowRoles } = require('../middleware/authMiddleware.js');
const { fileUpload } = require('../middleware/uploadMiddleware.js');
const {
    getTags, setWatching, setBlockedBy, addSubtask, updateSubtask, deleteSubtask,
} = require('../controller/taskExtras.controller.js');
const {
    getMyDashboard, getManagerDashboard, getCompanyDashboard, setTime, startTimer, stopTimer,
} = require('../controller/taskWork.controller.js');
const { uploadAttachments, attachFiles } = require('../controller/file.controller.js');
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
router.get('/my-dashboard', protect, getMyDashboard);
router.get('/company-dashboard', protect, adminOnly, getCompanyDashboard);
router.get('/manager-dashboard', protect, allowRoles("admin", "head"), getManagerDashboard);
router.get('/analytics', protect, getAnalytics);
router.get('/categories', protect, getCategories);
router.get('/tags', protect, getTags);
router.post('/upload', protect, fileUpload.array('files', 5), uploadAttachments);

router.get('/', protect, getTasks);
router.get('/:id', protect, getTaskById);
// Members may only create tasks assigned to themselves; createTask enforces that.
router.post('/', protect, createTask);
// Heads may edit tasks in their department; members use /status and /todo instead.
router.put('/:id', protect, allowRoles("admin", "head"), updateTask);
router.put('/:id/todo', protect, updateTaskCheckList);
router.put('/:id/status', protect, updateTaskStatus);
router.put('/:id/review', protect, reviewTask);
router.delete('/:id', protect, adminOnly, deleteTask);

router.post('/:id/attachments', protect, attachFiles);
router.put('/:id/watch', protect, setWatching);
router.put('/:id/time', protect, setTime);
router.post('/:id/timer/start', protect, startTimer);
router.post('/:id/timer/stop', protect, stopTimer);
router.put('/:id/blocked-by', protect, setBlockedBy);
router.post('/:id/subtasks', protect, addSubtask);
router.put('/:id/subtasks/:subId', protect, updateSubtask);
router.delete('/:id/subtasks/:subId', protect, deleteSubtask);

router.post('/:id/comments', protect, addComment);
router.delete('/:id/comments/:commentId', protect, deleteComment);

module.exports = router;
