const express = require("express");
const router = express.Router();
const { protect, adminOnly, allowRoles } = require('../middleware/authMiddleware.js');
const {
    createDepartment, getDepartments, updateDepartment, deleteDepartment,
    getDepartmentMembers, addDepartmentMember, removeDepartmentMember,
} = require('../controller/department.controller.js');

// Heads may read their own department; only admins reshape the org chart.
router.get('/', protect, allowRoles("admin", "head"), getDepartments);
router.get('/:id/members', protect, allowRoles("admin", "head"), getDepartmentMembers);

router.post('/', protect, adminOnly, createDepartment);
router.put('/:id', protect, adminOnly, updateDepartment);
router.delete('/:id', protect, adminOnly, deleteDepartment);

router.post('/:id/members', protect, adminOnly, addDepartmentMember);
router.delete('/:id/members/:userId', protect, adminOnly, removeDepartmentMember);

module.exports = router;
