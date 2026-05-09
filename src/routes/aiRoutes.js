import express from 'express';
import { generateFitting, getFittingHistory, detectOutfits, modelifyController, toggleFavorite, generateAvatar } from '../controllers/aiController.js';
import auth from '../middleware/auth.js';
import checkGenerationLimit from '../middleware/checkGenerationLimit.js';
import multer from 'multer';

const memoryUpload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fieldSize: 10 * 1024 * 1024, // 10MB limit for text fields
  }
});
const router = express.Router();

router.post('/generate', auth, checkGenerationLimit, memoryUpload.array('outfitImages', 4), generateFitting);
router.post('/detect-outfits', auth, memoryUpload.single('outfitImage'), detectOutfits);
router.post('/detect-demo', memoryUpload.single('outfitImage'), detectOutfits);
router.post('/modelify', memoryUpload.single('image'), modelifyController);
router.get('/history', auth, getFittingHistory);
router.post('/history/:id/favorite', auth, toggleFavorite);
router.post('/generate-avatar', auth, memoryUpload.single('referenceImage'), generateAvatar);

export default router;
