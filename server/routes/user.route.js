const express = require("express");
const router=express.Router();
const {protect,adminOnly,allowRoles}=require('../middleware/authMiddleware.js')
const {getUser,getUserById,deleteUser}=require('../controller/user.controller.js')



// Heads need this list to pick assignees - getUser scopes it to their department.
router.get('/',protect, allowRoles("admin","head"),getUser);
router.get('/:id',protect,getUserById)

/*  router.delete('/:id',protect,adminOnly,deleteUser);
*/




module.exports=router;