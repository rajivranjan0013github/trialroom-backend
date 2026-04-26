import User from '../models/User.js';
import Fitting from '../models/Fitting.js';
import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ status: 'Success', count: users.length, data: users });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user;
    console.log('--- DELETE ACCOUNT REQUEST ---', userId);
    const publicDomain = process.env.R2_PUBLIC_DOMAIN?.replace(/\/$/, "") || "";

    // 1. Find the user and their fittings to collect image keys
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ status: 'Error', message: 'User not found' });
    const fittings = await Fitting.find({ user: userId });

    const keysToDelete = [];

    // Helper to extract key from full URL
    const addKeyFromUrl = (url) => {
      if (url && url.includes(publicDomain)) {
        const key = url.split(`${publicDomain}/`)[1];
        if (key) keysToDelete.push({ Key: key });
      }
    };

    // Collect keys from User profile
    (user.profileSetup || []).forEach(url => addKeyFromUrl(url));

    // Collect keys from Fitting history
    fittings.forEach(f => {
      addKeyFromUrl(f.resultImage);
      (f.outfitImages || []).forEach(url => addKeyFromUrl(url));
    });

    // 2. Batch delete from Cloudflare R2
    if (keysToDelete.length > 0) {
      console.log(`[DeleteAccount] Cleaning up ${keysToDelete.length} images from R2...`);
      try {
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: bucketName,
          Delete: { Objects: keysToDelete }
        }));
      } catch (s3Err) {
        console.error('[DeleteAccount] R2 Cleanup Error:', s3Err.message);
        // We continue anyway to ensure the DB record is deleted
      }
    }

    // 3. Delete from Database
    await Fitting.deleteMany({ user: userId });
    await User.findByIdAndDelete(userId);

    res.json({ status: 'Success', message: 'Account and all data permanently deleted' });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export const saveFCMToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ status: 'Error', message: 'token is required' });

    await User.findByIdAndUpdate(req.user, { $set: { fcmToken: token } });
    res.json({ status: 'Success' });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    console.log('--- UPDATE PROFILE START ---');
    console.log('User:', req.user);
    console.log('Body Keys:', Object.keys(req.body || {}));
    console.log('Slot 0:', req.body?.slot_0);
    console.log('Slot 1:', req.body?.slot_1);
    console.log('Files Keys:', req.files ? Object.keys(req.files) : 'No Files');
    if (req.files?.images) console.log('Images Count:', req.files.images.length);

    const body = req.body || {};
    const updateData = {};
    const publicDomain = process.env.R2_PUBLIC_DOMAIN?.replace(/\/$/, "") || "";

    // req.files is now { images: [...], avatar: [...] } from upload.fields()
    const imageFiles = req.files?.images ?? [];

    if (body.name) updateData.name = body.name;
    if (body.height) updateData.height = Number(body.height);
    if (body.weight) updateData.weight = Number(body.weight);

    // Reconstruct the 4-slot profileSetup array from the slot manifest
    let newFileIndex = 0;
    const finalProfileUrls = [];
    let hasSlots = false;

    for (let i = 0; i < 4; i++) {
      const slotValue = body[`slot_${i}`];
      if (slotValue) hasSlots = true;

      if (slotValue === 'NEW_FILE') {
        if (imageFiles[newFileIndex]) {
          finalProfileUrls.push(`${publicDomain}/${imageFiles[newFileIndex].key}`);
          newFileIndex++;
        }
      } else if (slotValue && slotValue !== 'EMPTY' && slotValue.startsWith('http')) {
        finalProfileUrls.push(slotValue);
      }
    }

    if (hasSlots) {
      updateData.profileSetup = finalProfileUrls;
    }

    const user = await User.findByIdAndUpdate(
      req.user,
      { $set: updateData },
      { returnDocument: 'after', runValidators: true }
    );

    if (!user) return res.status(404).json({ status: 'Error', message: 'User not found' });

    res.status(200).json({ status: 'Success', data: user });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(400).json({ status: 'Error', message: error.message });
  }
};
