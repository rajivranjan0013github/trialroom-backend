import { PutObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';
import HairstyleFitting from '../models/HairstyleFitting.js';
import User from '../models/User.js';
import { generateHairstyleTryOn } from '../services/hairstyleService.js';
import { sendPushNotification } from '../services/notificationService.js';

export const tryOnHairstyle = async (req, res) => {
  try {
    const { faceImageUrl } = req.body;
    const faceFile = req.files?.faceImage?.[0];
    const refFile  = req.files?.hairstyleRef?.[0];

    if (!refFile) {
      return res.status(400).json({ status: 'Error', message: 'hairstyleRef image is required' });
    }

    // ── Pre-process: Upload reference images before starting background task ──
    let faceBuffer, faceMime, resolvedFaceUrl;

    if (faceFile) {
      faceBuffer = faceFile.buffer;
      faceMime   = faceFile.mimetype;
      const faceKey = `hairstyle-faces/${Date.now()}-face.jpg`;
      await s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: faceKey, Body: faceBuffer, ContentType: faceMime }));
      resolvedFaceUrl = `${process.env.R2_PUBLIC_DOMAIN}/${faceKey}`;
    } else if (faceImageUrl) {
      const r = await fetch(faceImageUrl);
      if (!r.ok) throw new Error('Could not fetch face image');
      faceBuffer = Buffer.from(await r.arrayBuffer());
      faceMime   = r.headers.get('content-type') || 'image/jpeg';
      resolvedFaceUrl = faceImageUrl;
    } else {
      return res.status(400).json({ status: 'Error', message: 'Either faceImageUrl or faceImage file is required' });
    }

    // Upload hairstyle reference
    const refKey = `hairstyle-refs/${Date.now()}-ref.jpg`;
    await s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: refKey, Body: refFile.buffer, ContentType: refFile.mimetype }));
    const refUrl = `${process.env.R2_PUBLIC_DOMAIN}/${refKey}`;

    // ── Create Pending Entry ──
    const fitting = await HairstyleFitting.create({
      user: req.user,
      faceImageUrl: resolvedFaceUrl,
      hairstyleId: 'custom',
      hairstyleName: 'Custom Reference',
      hairstyleCategory: 'custom',
      hairstyleRefUrl: refUrl,
      status: 'pending'
    });

    // Return taskId immediately
    res.json({ 
      status: 'Success', 
      message: 'Generation started', 
      taskId: fitting._id 
    });

    // ── Background Generation ──
    (async () => {
      try {
        const resultBuffer = await generateHairstyleTryOn(faceBuffer, faceMime, refFile.buffer, refFile.mimetype);

        // Upload result
        const resultKey = `hairstyle-results/${Date.now()}-result.png`;
        await s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: resultKey, Body: resultBuffer, ContentType: 'image/png' }));
        const resultUrl = `${process.env.R2_PUBLIC_DOMAIN}/${resultKey}`;

        // Update DB
        await HairstyleFitting.findByIdAndUpdate(fitting._id, {
          resultImage: resultUrl,
          status: 'completed'
        });

        // Notify user
        const userDoc = await User.findById(req.user);
        if (userDoc?.fcmToken) {
          await sendPushNotification(
            userDoc.fcmToken,
            "New Look Ready! ✨",
            "Your hairstyle try-on is complete. Come check out your new look!",
            resultUrl,
            "hairstyle_complete"
          );
        }
      } catch (error) {
        console.error('[HairstyleBG] Try-on failed:', error);
        await HairstyleFitting.findByIdAndUpdate(fitting._id, {
          status: 'failed',
          error: error.message
        });

        // Notify failure
        const userDoc = await User.findById(req.user);
        if (userDoc?.fcmToken) {
          await sendPushNotification(
            userDoc.fcmToken,
            "Generation Failed ❌",
            error.message || "Something went wrong with your hairstyle generation.",
            null,
            "hairstyle_fail"
          );
        }
      }
    })();

  } catch (error) {
    console.error('[Hairstyle] Try-on error:', error);
    res.status(500).json({ status: 'Error', message: 'Hairstyle try-on failed', detail: error.message });
  }
};

export const getHairstyleHistory = async (req, res) => {
  try {
    const history = await HairstyleFitting.find({ user: req.user }).sort({ createdAt: -1 });
    res.json({ status: 'Success', data: history });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export const toggleHairstyleFavorite = async (req, res) => {
  try {
    const fitting = await HairstyleFitting.findOne({ _id: req.params.id, user: req.user });
    if (!fitting) return res.status(404).json({ status: 'Error', message: 'Fitting not found' });
    fitting.isFavorite = !fitting.isFavorite;
    await fitting.save();
    res.json({ status: 'Success', isFavorite: fitting.isFavorite });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};
