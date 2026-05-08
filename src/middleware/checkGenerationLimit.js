import User from '../models/User.js';

const FREE_LIMIT = 2;

const checkGenerationLimit = async (req, res, next) => {
  try {
    const user = await User.findById(req.user);
    if (!user) return res.status(401).json({ status: 'Error', message: 'User not found' });

    if (user.isPremium) return next();

    if (user.generationsUsed >= FREE_LIMIT) {
      return res.status(403).json({
        status: 'Error',
        code: 'GENERATION_LIMIT_REACHED',
        message: 'You have used your 2 free try-ons. Upgrade to Premium for unlimited access.',
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export default checkGenerationLimit;
