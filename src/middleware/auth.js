import jwt from 'jsonwebtoken';

const auth = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ status: 'Error', message: 'No authentication token, access denied' });
    }

    const token = authHeader.split(' ')[1];
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!verified) {
      return res.status(401).json({ status: 'Error', message: 'Token verification failed, authorization denied' });
    }

    req.user = verified.id; // Store the user ID from the token
    next();
  } catch (err) {
    res.status(401).json({ status: 'Error', message: 'Invalid or expired token' });
  }
};

export default auth;
