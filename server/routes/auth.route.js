const express = require("express");
const router = express.Router();
const { uploadProfileImage } = require('../controller/file.controller.js');
const { registerUser, loginUser, logoutUser, getUserProfile, updateUserProfile } = require('../controller/auth.controller.js');
const { protect } = require('../middleware/authMiddleware.js')
const upload = require('../middleware/uploadMiddleware.js')




router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.get('/profile', protect, getUserProfile);
router.put('/profile', protect, updateUserProfile);

router.post("/upload-image", protect, upload.single("image"), uploadProfileImage);
module.exports = router;
