import express from 'express';
import { generateFitting, getFittingHistory, detectOutfits, removeBackground, modelifyController, streamScanner } from '../controllers/aiController.js';
import auth from '../middleware/auth.js';
import multer from 'multer';

const memoryUpload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.post('/generate', auth, memoryUpload.array('outfitImages', 4), generateFitting); 
router.post('/detect-outfits', auth, memoryUpload.single('outfitImage'), detectOutfits);
router.post('/scan-stream', auth, memoryUpload.single('outfitImage'), streamScanner);
router.post('/detect-demo', memoryUpload.single('outfitImage'), detectOutfits);
router.post('/remove-bg', memoryUpload.single('image'), removeBackground);
router.post('/modelify', memoryUpload.single('image'), modelifyController);
router.get('/history', auth, getFittingHistory);

export default router;
