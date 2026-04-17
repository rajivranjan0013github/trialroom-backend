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
    const { name } = req.body;
    let newFileIndex = 0;
    const finalProfileUrls = [];
    const publicDomain = process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, "");

    // 1. Reconstruct the 4-slot array based on the manifest
    for (let i = 0; i < 4; i++) {
      const slotValue = req.body[`slot_${i}`];

      if (slotValue === 'NEW_FILE') {
        if (req.files && req.files[newFileIndex]) {
          finalProfileUrls.push(`${publicDomain}/${req.files[newFileIndex].key}`);
          newFileIndex++;
        }
      } else if (slotValue && slotValue !== 'EMPTY' && slotValue.startsWith('http')) {
        finalProfileUrls.push(slotValue);
      }
    }

    // 2. UPDATE DATABASE ONLY
    // We purposefully DO NOT delete files from R2 anymore, 
    // ensuring images stay in the bucket for history/other uses.
    const user = await User.findByIdAndUpdate(
      req.user, 
      { name, profileSetup: finalProfileUrls },
      { new: true, runValidators: true }
    );

    if (!user) return res.status(404).json({ status: 'Error', message: 'User not found' });

    res.status(200).json({ status: 'Success', data: user });
  } catch (error) {
    console.error('Update Profile Error:', error);
    res.status(400).json({ status: 'Error', message: error.message });
  }
};
