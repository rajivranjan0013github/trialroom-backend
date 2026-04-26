import OpenAI, { toFile } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT =
  `You are a hairstyle try-on AI. ` +
  `The first image is the person — preserve their face, exact skin tone, facial features, and expression exactly as they are. ` +
  `The second image shows a hairstyle reference — apply that exact hairstyle to the person in the first image. ` +
  `Keep everything else (clothing, background, skin tone) identical. Only change the hair. ` +
  `Render photorealistic with natural lighting and hair texture.`;

export const generateHairstyleTryOn = async (faceBuffer, faceMime, refBuffer, refMime) => {
  const faceFile = await toFile(faceBuffer, 'face.jpg', { type: faceMime });
  const refFile  = await toFile(refBuffer,  'ref.jpg',  { type: refMime });

  console.log('[Hairstyle] Generating via gpt-image-2 with reference image...');

  const response = await openai.images.edit({
    model: 'gpt-image-2',
    image: [faceFile, refFile],
    prompt: PROMPT,
    n: 1,
    size: '1024x1024',
    quality: 'low',
  });

  const b64 = response.data[0].b64_json;
  if (!b64) throw new Error('OpenAI did not return an image');

  console.log('[Hairstyle] Generation complete');
  return Buffer.from(b64, 'base64');
};
