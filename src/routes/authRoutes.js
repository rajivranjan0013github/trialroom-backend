import express from 'express';
import { googleLogin, appleLogin } from '../controllers/authController.js';

const router = express.Router();

// Log all auth requests


router.post('/google', googleLogin);
router.post('/apple', appleLogin);

export default router;
