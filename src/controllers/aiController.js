import { generateFittingImageMulti, detectFashionItems, removeBackgroundGemini, generateStandingAvatarOpenAI } from '../services/geminiService.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';
import Fitting from '../models/Fitting.js';
import HairstyleFitting from '../models/HairstyleFitting.js';
import User from '../models/User.js';
import { sendPushNotification } from '../services/notificationService.js';

export const generateFitting = async (req, res) => {
  try {
    const { personUrls } = req.body;
    const outfitFiles = req.files;

    const urls = JSON.parse(personUrls || '[]');
    const selectedItems = JSON.parse(req.body.selectedItems || '[]');
    const detectedItems = JSON.parse(req.body.detectedItems || '[]');
    const title = req.body.title || 'Virtual Look Synthesis';
    const category = req.body.category || 'Outfit';

    if (urls.length === 0 || !outfitFiles || outfitFiles.length === 0) {
      return res.status(400).json({ status: 'Error', message: 'Person References and Outfit Images are required' });
    }

    // 1. Initial save to DB as 'pending'
    const newFitting = await Fitting.create({
      user: req.user,
      personReferences: urls,
      outfitImages: [], // Will populate in background
      detectedItems,
      selectedItems,
      title,
      category,
      status: 'pending'
    });

    // 2. Return taskId immediately
    res.json({
      status: 'Success',
      message: 'Generation started',
      taskId: newFitting._id
    });

    // 3. Process in background
    (async () => {
      try {
        // A. Upload outfit images to R2
        const outfitUrls = await Promise.all(outfitFiles.map(async (file) => {
          const fileName = `outfits/${Date.now()}-${file.originalname}`;
          await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
          }));
          return `${process.env.R2_PUBLIC_DOMAIN}/${fileName}`;
        }));

        // B. Generate fitting image
        const generatedBuffer = await generateFittingImageMulti(urls, outfitFiles, selectedItems);

        // C. Upload AI result to R2
        const resultFileName = `results/${Date.now()}-fitting.png`;
        await s3Client.send(new PutObjectCommand({
          Bucket: bucketName,
          Key: resultFileName,
          Body: generatedBuffer,
          ContentType: 'image/png',
        }));
        const resultUrl = `${process.env.R2_PUBLIC_DOMAIN}/${resultFileName}`;

        // D. Update database entry
        const updatedUser = await User.findByIdAndUpdate(req.user, { $inc: { generationsUsed: 1 } }, { new: true });
        
        await Fitting.findByIdAndUpdate(newFitting._id, {
          outfitImages: outfitUrls,
          resultImage: resultUrl,
          status: 'completed'
        });

        // E. Send Push Notification
        if (updatedUser?.fcmToken) {
          await sendPushNotification(
            updatedUser.fcmToken,
            "Your Look is Ready! ✨",
            "The virtual try-on is complete. Tap to see your new style!",
            resultUrl,
            "history"
          );
        }
      } catch (bgError) {
        console.error('[FittingBG] Generation failed:', bgError);
        await Fitting.findByIdAndUpdate(newFitting._id, {
          status: 'failed',
          error: bgError.message
        });

        // Notify user about the failure
        const updatedUser = await User.findById(req.user);
        if (updatedUser?.fcmToken) {
          await sendPushNotification(
            updatedUser.fcmToken,
            "Generation Failed ❌",
            bgError.message || "Something went wrong while crafting your look. Please try again.",
            null,
            "history_fail"
          );
        }
      }
    })();

  } catch (error) {
    console.error('Generation Entry Error:', error);
    res.status(500).json({ status: 'Error', message: 'Failed to start generation' });
  }
};

export const getTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await Fitting.findOne({ _id: id, user: req.user });
    
    if (!task) {
      return res.status(404).json({ status: 'Error', message: 'Task not found' });
    }

    res.json({
      status: 'Success',
      data: {
        id: task._id,
        taskStatus: task.status, // 'pending', 'completed', 'failed'
        resultImage: task.resultImage,
        error: task.error
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export const getFittingHistory = async (req, res) => {
  try {
    const [outfitHistory, hairstyleHistory] = await Promise.all([
      Fitting.find({ user: req.user, status: 'completed' }),
      HairstyleFitting.find({ user: req.user })
    ]);
    
    // Merge and tag them so the frontend knows how to render details
    const merged = [
      ...outfitHistory.map(item => ({ ...item.toObject(), galleryType: 'outfit' })),
      ...hairstyleHistory.map(item => ({ ...item.toObject(), galleryType: 'hairstyle' }))
    ];

    // Sort by most recent first
    merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ status: 'Success', data: merged });
  } catch (error) {
    console.error('Get Gallery History Error:', error);
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export const detectOutfits = async (req, res) => {
  try {
    const outfitFile = req.file;
    if (!outfitFile) {
      return res.status(400).json({ status: 'Error', message: 'Outfit Image is required' });
    }

    const detectionResult = await detectFashionItems(outfitFile.buffer, outfitFile.mimetype);

    res.json({
      status: 'Success',
      data: detectionResult.items,
      suggestedTitle: detectionResult.suggestedTitle,
      category: detectionResult.category
    });
  } catch (error) {
    console.error('Detection Error:', error);
    res.status(500).json({ status: 'Error', message: 'Detection failed', detail: error.message });
  }
};

export const modelifyController = async (req, res) => {
  try {
    const originalFile = req.file;
    if (!originalFile) {
      return res.status(400).json({ status: 'Error', message: 'Image is required' });
    }

    const processedBuffer = await removeBackgroundGemini(originalFile.buffer, originalFile.mimetype);

    const fileName = `modelified/${Date.now()}-model.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: processedBuffer,
      ContentType: 'image/png',
    }));

    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${fileName}`;

    res.json({ status: 'Success', url: resultUrl });
  } catch (error) {
    console.error('Modelify Error:', error);
    res.status(500).json({ status: 'Error', message: 'Modelify failed', detail: error.message });
  }
};
export const generateAvatar = async (req, res) => {
  try {
    const file = req.file;
    const { height, weight } = req.body;
    if (!file) {
      return res.status(400).json({ status: 'Error', message: 'Reference image is required' });
    }

    const publicDomain = process.env.R2_PUBLIC_DOMAIN?.replace(/\/$/, "") || "";

    // 1. Generate standing avatar via OpenAI (User waits for this)
    const generatedBuffer = await generateStandingAvatarOpenAI(file.buffer, file.mimetype);
    const imageBase64 = generatedBuffer.toString('base64');

    // 2. Return immediate response with base64 for instant preview
    res.json({ 
      status: 'Success', 
      imageBase64 
    });

    // 3. Background processing (R2 upload and DB update)
    (async () => {
      try {
        const timestamp = Date.now();
        const originalFileName = `profiles/${timestamp}-original.jpg`;
        const avatarFileName = `profiles/${timestamp}-avatar.jpg`;

        // Upload both in parallel
        await Promise.all([
          s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: originalFileName,
            Body: file.buffer,
            ContentType: file.mimetype,
          })),
          s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: avatarFileName,
            Body: generatedBuffer,
            ContentType: 'image/jpeg',
          }))
        ]);

        const originalUrl = `${publicDomain}/${originalFileName}`;
        const avatarUrl = `${publicDomain}/${avatarFileName}`;

        // Update user profileSetup in DB
        const updateData = { $set: { profileSetup: [avatarUrl, originalUrl] } };
        if (height) updateData.$set.height = Number(height);
        if (weight) updateData.$set.weight = Number(weight);

        const updatedUser = await User.findByIdAndUpdate(
          req.user,
          updateData,
          { new: true }
        );

        // 5. Send Push Notification once everything is ready
        if (updatedUser?.fcmToken) {
          await sendPushNotification(
            updatedUser.fcmToken,
            "Your Avatar is Ready! ✨",
            "We've finished setting up your virtual twin. Come see your standing model!",
            avatarUrl,
            "avatar_ready"
          );
        }

      } catch (bgError) {
        console.error('[AvatarBG] Critical background save failure:', bgError);
      }
    })();

  } catch (error) {
    console.error('Avatar Generation Error:', error);
    res.status(500).json({ status: 'Error', message: 'Avatar generation failed', detail: error.message });
  }
};

export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    const fitting = await Fitting.findOne({ _id: id, user: req.user });
    
    if (!fitting) {
      return res.status(404).json({ status: 'Error', message: 'Fitting not found' });
    }

    fitting.isFavorite = !fitting.isFavorite;
    await fitting.save();

    res.json({ status: 'Success', isFavorite: fitting.isFavorite });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};
