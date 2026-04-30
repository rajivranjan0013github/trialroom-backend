import express from 'express';
import { handleRevenueCatWebhook } from '../controllers/revenuecatController.js';

const router = express.Router();

// The webhook endpoint for RevenueCat servers.
// Note: Do NOT add JWT auth middleware here. RevenueCat servers call this,
// not your authenticated client app.
router.post('/webhook', handleRevenueCatWebhook);

export default router;
