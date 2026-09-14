const express = require("express");
const router=express.Router();
const {protect,adminOnly,allowRoles}=require('../middleware/authMiddleware.js')
const {getUser,getUserById,importMembers}=require('../controller/user.controller.js')
const {csvUpload}=require('../middleware/uploadMiddleware.js')



// Heads need this list to pick assignees - getUser scopes it to their department.
router.get('/',protect, allowRoles("admin","head"),getUser);
// Creating accounts stays admin-only: a head importing a CSV could name any department.
router.post('/import',protect,adminOnly,csvUpload.single('file'),importMembers);
router.get('/:id',protect,getUserById)

/*  router.delete('/:id',protect,adminOnly,deleteUser);
*/




module.exports=router;
