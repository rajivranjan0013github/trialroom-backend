import express from 'express';
import { getAllUsers, getMe, updateProfile, deleteAccount } from '../controllers/userController.js';
import auth from '../middleware/auth.js';
import upload from '../utils/upload.js';

const router = express.Router();

router.get('/all',  getAllUsers);
router.get('/me', auth, getMe);
router.post('/', auth, upload.array('images', 4), updateProfile);
router.delete('/me', auth, deleteAccount);

export default router;
