import express from 'express';
import multer from 'multer';
import auth from '../middleware/auth.js';
import { tryOnHairstyle, getHairstyleHistory, toggleHairstyleFavorite } from '../controllers/hairstyleController.js';

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fieldSize: 10 * 1024 * 1024, // 10MB limit for text fields
  }
});
const router = express.Router();

router.post('/try-on', auth, upload.fields([{ name: 'faceImage', maxCount: 1 }, { name: 'hairstyleRef', maxCount: 1 }]), tryOnHairstyle);
router.get('/history', auth, getHairstyleHistory);
router.post('/history/:id/favorite', auth, toggleHairstyleFavorite);

export default router;
