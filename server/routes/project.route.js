const express = require("express");
const router = express.Router();
const { protect, adminOnly, allowRoles } = require('../middleware/authMiddleware.js');
const {
    getProjects, getProjectById, createProject, updateProject, deleteProject,
} = require('../controller/project.controller.js');

router.get('/', protect, getProjects);
router.get('/:id', protect, getProjectById);
router.post('/', protect, allowRoles("admin", "head"), createProject);
router.put('/:id', protect, updateProject);          // manager / creator / department head / admin, checked in the controller
router.delete('/:id', protect, adminOnly, deleteProject);

module.exports = router;
