import User from '../models/User.js';
import Fitting from '../models/Fitting.js';

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
    const user = await User.findByIdAndDelete(userId);
    if (!user) return res.status(404).json({ status: 'Error', message: 'User not found' });

    await Fitting.deleteMany({ user: userId });

    res.json({ status: 'Success', message: 'Account deleted' });
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
    const body = req.body || {};
    const updateData = {};
    const publicDomain = process.env.R2_PUBLIC_DOMAIN?.replace(/\/$/, "") || "";

    // req.files is now { images: [...], avatar: [...] } from upload.fields()
    const imageFiles = req.files?.images ?? [];
    const avatarFile = req.files?.avatar?.[0] ?? null;

    if (body.name) updateData.name = body.name;
    if (body.height) updateData.height = Number(body.height);
    if (body.weight) updateData.weight = Number(body.weight);

    // Handle avatar upload
    if (avatarFile) {
      updateData.avatar = `${publicDomain}/${avatarFile.key}`;
    }

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
      { new: true, runValidators: true }
    );

    if (!user) return res.status(404).json({ status: 'Error', message: 'User not found' });

    res.status(200).json({ status: 'Success', data: user });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(400).json({ status: 'Error', message: error.message });
  }
};
