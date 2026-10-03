const express = require("express");
const router=express.Router();
const  {protect,adminOnly,allowRoles}=require('../middleware/authMiddleware.js')
const {exportTasksReport,exportUsersReport,getReport}=require("../controller/reports.controller.js")

router.get('/export/tasks',protect,allowRoles("admin","head"),exportTasksReport)
router.get('/export/users',protect,adminOnly ,exportUsersReport)
// Static paths above, or Express would read "export" as a report kind.
router.get('/:kind',protect,allowRoles("admin","head"),getReport)







module.exports=router;