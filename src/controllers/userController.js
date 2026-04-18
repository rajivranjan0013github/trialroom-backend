import User from '../models/User.js';

export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const body = req.body || {};
    const updateData = {};
    
    if (body.name) updateData.name = body.name;

    let newFileIndex = 0;
    const finalProfileUrls = [];
    const publicDomain = process.env.R2_PUBLIC_DOMAIN?.replace(/\/$/, "") || "";

    // 1. Reconstruct the 4-slot array based on the manifest
    let hasSlots = false;
    for (let i = 0; i < 4; i++) {
      const slotValue = body[`slot_${i}`];
      if (slotValue) hasSlots = true;

      if (slotValue === 'NEW_FILE') {
        if (req.files && req.files[newFileIndex]) {
          finalProfileUrls.push(`${publicDomain}/${req.files[newFileIndex].key}`);
          newFileIndex++;
        }
      } else if (slotValue && slotValue !== 'EMPTY' && slotValue.startsWith('http')) {
        finalProfileUrls.push(slotValue);
      }
    }

    if (hasSlots) {
      updateData.profileSetup = finalProfileUrls;
    }

    // 2. UPDATE DATABASE ONLY
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
