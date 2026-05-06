import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import User from '../models/User.js';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const appleJwksClient = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 86400000,
});

function getAppleSigningKey(header, callback) {
  appleJwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) callback(err);
    else callback(null, key.getPublicKey());
  });
}

export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;



    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID
      ].filter(Boolean),
    });
    const { name, email, sub: googleId } = ticket.getPayload();


    let user = await User.findOne({ googleId });
    if (!user) {

      user = await User.create({ name, email, googleId });

    } else {

    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ status: 'Success', token, user });
  } catch (error) {
    console.error('[AUTH-CTRL] googleLogin ERROR:', error.message);
    console.error('[AUTH-CTRL] Stack:', error.stack?.substring(0, 500));
    res.status(400).json({ status: 'Error', message: 'Google authentication failed', detail: error.message });
  }
};

export const appleLogin = async (req, res) => {
  try {
    const { idToken, displayName, email: providedEmail } = req.body;


    if (!idToken) {

      return res.status(400).json({ error: 'Identity token is required' });
    }


    const decodedToken = await new Promise((resolve, reject) => {
      jwt.verify(
        idToken,
        getAppleSigningKey,
        {
          algorithms: ['RS256'],
          issuer: 'https://appleid.apple.com',
          audience: process.env.APPLE_CLIENT_ID,
        },
        (err, decoded) => {
          if (err) reject(err);
          else resolve(decoded);
        }
      );
    });

    const appleId = decodedToken.sub;
    const resolvedEmail = decodedToken.email || providedEmail;


    if (!resolvedEmail) {

      return res.status(400).json({ error: 'Email is required. Please try signing in again.' });
    }

    let user = await User.findOne({ googleId: `apple:${appleId}` });
    if (!user) {

      user = await User.create({
        name: displayName || resolvedEmail.split('@')[0] || 'Apple User',
        email: resolvedEmail,
        googleId: `apple:${appleId}`,
      });

    } else {

    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ status: 'Success', token, user });
  } catch (error) {
    console.error('[AUTH-CTRL] appleLogin ERROR:', error.message);
    console.error('[AUTH-CTRL] Stack:', error.stack?.substring(0, 500));
    res.status(401).json({ status: 'Error', message: 'Apple authentication failed', detail: error.message });
  }
};
