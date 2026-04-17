import express from 'express';
import { generateFitting, getFittingHistory, detectOutfits } from '../controllers/aiController.js';
import auth from '../middleware/auth.js';
import multer from 'multer';

const memoryUpload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.post('/generate', auth, memoryUpload.array('outfitImages', 4), generateFitting); 
router.post('/detect-outfits', auth, memoryUpload.single('outfitImage'), detectOutfits);
router.get('/history', auth, getFittingHistory);

export default router;
