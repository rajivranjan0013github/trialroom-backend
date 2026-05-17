import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI, { toFile } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const STANDING_POSE_PROMPT = `Using the provided reference image, generate a realistic full-body image of the same person.

Maintain:
- Same face, identity, and body proportions (height, weight, physique)
- Same outfit and clothing details (exact colors, fit, fabric, accessories)

Modify:
- Convert pose into a natural standing position
- Posture should be straight, upright, and confident (good posture)
- Shoulders relaxed, spine aligned
- Weight slightly shifted to one leg for a casual stance

Pose details:
- Arms relaxed (one arm naturally by the side or lightly bent)
- Hands in a natural position (not stiff or posed)
- Legs slightly apart or one leg slightly forward for balance
- Head slightly tilted or facing forward

Expression:
- Soft, casual expression with a slight natural smile (not serious)

Framing & Composition:
- Crucial: The person must be perfectly centered and occupy the full vertical height of the image frame from head to toe (roughly 85-90% of the image height).
- If the reference image was taken from a long distance, zoom in and scale up the person so they are a prominent, clear, close-up full-body shot. Do not render them as a small, tiny, or distant figure.
- The top of the head should be positioned close to the top of the frame, and the feet should be positioned close to the bottom of the frame, fully visible.

Style:
- Realistic, candid photography feel (not studio stiff)
- Preserve lighting and background if possible
- No distortion, no change in identity or clothing

Quality:
- High detail, sharp, natural skin texture, realistic proportions`;

export const generateStandingAvatarOpenAI = async (fileBuffer, mimeType) => {
  try {
    const imageFile = await toFile(fileBuffer, 'reference.jpg', { type: mimeType });

    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: [imageFile],
      prompt: STANDING_POSE_PROMPT,
      n: 1,
      size: '1024x1536',
      quality: 'low',
    });

    const b64 = response.data[0].b64_json;
    if (!b64) throw new Error('OpenAI did not return an image');

    return Buffer.from(b64, 'base64');
  } catch (error) {
    console.error('Standing Avatar Generation Error:', error);
    throw error;
  }
};

export const generateFittingImageMulti = async (personUrls, outfitFiles, selectedItems = []) => {
  try {
    // 1. Fetch person reference images from URLs
    const personBuffers = await Promise.all(personUrls.slice(0, 1).map(async (url) => {
      if (!url) return null;
      // Handle Base64 Data URLs (often sent during instant preview)
      if (url.startsWith('data:')) {
        const [meta, data] = url.split(',');
        const mimeType = meta.split(':')[1].split(';')[0];
        const buffer = Buffer.from(data, 'base64');
        return { buffer, mimeType };
      }

      // Handle standard HTTP/HTTPS URLs
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || 'image/jpeg';
      return { buffer: Buffer.from(arrayBuffer), mimeType };
    }));
    const validPersonImages = personBuffers.filter(p => p !== null);

    if (validPersonImages.length === 0) {
      throw new Error('No valid person reference images could be fetched');
    }

    // 2. Convert all images to OpenAI File objects
    const personFiles = await Promise.all(
      validPersonImages.map((img, i) =>
        toFile(img.buffer, `person_${i}.jpg`, { type: img.mimeType })
      )
    );
    const outfitFileObjects = await Promise.all(
      outfitFiles.map((file, i) =>
        toFile(file.buffer, `outfit_${i}.png`, { type: file.mimetype })
      )
    );

    const itemList = selectedItems.join(', ');
    const prompt = selectedItems.length > 0
      ? `You are a virtual try-on AI. The first image is the person — preserve their face, exact skin tone, body, and identity exactly. Do not lighten, darken, or alter their skin tone in any way. From the second image, copy the pose and apply ONLY these specific clothing items to the person: ${itemList}. Do not change any other part of their outfit. Output a realistic full-body photo on a white background.`
      : `You are a virtual try-on AI. The first image is the person — preserve their face, exact skin tone, body, and identity exactly. Do not lighten, darken, or alter their skin tone in any way. From the second image, copy the complete outfit style and the pose. Output a realistic full-body photo on a white background.`;

    const response = await openai.images.edit({
      model: 'gpt-image-2',
      image: [...personFiles, ...outfitFileObjects],
      prompt,
      n: 1,
      size: '1024x1536',
      quality: "low"
    });

    const b64 = response.data[0].b64_json;
    if (!b64) throw new Error('OpenAI did not return an image');
    const buffer = Buffer.from(b64, 'base64');

    return buffer;
  } catch (error) {
    console.error('OpenAI Style Transfer Error:', error);
    throw error;
  }
};

export const detectFashionItems = async (fileBuffer, mimeType) => {
  try {

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: "application/json",
        // thinkingConfig: { thinkingBudget: 0 },
      }
    });

    const prompt = `Return a JSON list of distinct fashion items and accessories detected in the image.
    Include: outfits, necklace, watch, footwear, hats, glasses, bags, etc.
    Rules:
    - Treat paired items as ONE entry (e.g. both shoes = one "Sandals" entry, both socks = one entry).
    - Never list the same item type more than once.
    - Use a short item-type label only, no colors (e.g. "Sneakers", "Watch", "Jeans", "Sunglasses").
    - "point": [y, x] the single most visually prominent pixel ON the item surface, normalized to 0-1000. (e.g. center of a shoe's toe box, buckle of a watch, middle of a shirt's chest area).
    - "scale": a number from 0 to 1000 representing how large the item appears in the image. It is roughly the radius around the point that covers the item. Small items like a watch ≈ 40-80, medium items like shoes ≈ 100-200, large items like a jacket ≈ 250-450.

    Format:
    {
      "suggestedTitle": "string",
      "category": "Outfit" | "Top" | "Bottom" | "Dress",
      "items": [
        { "label": "string", "point": [number, number], "scale": number }
      ]
    }`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType
        }
      }
    ]);

    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);


    return parsed;
  } catch (error) {
    console.error('Gemini Detection Error:', error);
    throw error;
  }
};
export const modelifyPerson = async (fileBuffer, mimeType) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-image', // Proven to work in this codebase
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      }
    });

    const prompt = `Transform the person in this photo into a professional fashion model. Enhance their pose to a more confident, professional 'model pose' while strictly maintaining their natural body symmetry and proportions. Crucially, keep the person's facial identity and key features exactly the same as the original. Output the result on a solid white background.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType
        }
      }
    ]);

    const generatedPart = result.response.candidates[0].content.parts.find(p => p.inlineData);
    if (!generatedPart) throw new Error('Gemini did not return a generated image');

    return Buffer.from(generatedPart.inlineData.data, 'base64');
  } catch (error) {
    console.error('Gemini Modelify Error:', error);
    throw error;
  }
};

export const getSegmentationMask = async (fileBuffer, mimeType) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview', // Proven to work in this codebase
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `Give the segmentation mask for the entire person in this image. 
    Output a JSON object where the entry contains the 2D bounding box in the key 'box_2d', the segmentation mask in key 'mask', and the text label 'person' in the key 'label'. 
    The mask should be a base64 encoded PNG probability map.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType
        }
      }
    ]);

    const response = await result.response;
    const data = JSON.parse(response.text());

    // Sometimes Gemini returns a list
    const maskData = Array.isArray(data) ? data[0] : (data.items ? data.items[0] : data);

    if (!maskData || !maskData.mask) {
      throw new Error('No segmentation mask returned from Gemini');
    }

    return {
      maskBase64: maskData.mask,
      box_2d: maskData.box_2d
    };
  } catch (error) {
    console.error('Gemini Segmentation Error:', error);
    throw error;
  }
};

export const removeBackgroundGemini = async (fileBuffer, mimeType) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-image', // Model that supports IMAGE modality output
      generationConfig: {
        responseModalities: ['IMAGE'],
      }
    });

    const prompt = `Extract the person from this photo and transform them into a professional fashion model. Enhance their pose to a more confident, professional 'model pose' while strictly maintaining their natural body symmetry, proportions, and facial identity. Return the resulting enhanced model on a transparent background.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: fileBuffer.toString('base64'),
          mimeType: mimeType
        }
      }
    ]);

    const generatedPart = result.response.candidates[0].content.parts.find(p => p.inlineData);
    if (!generatedPart) throw new Error('Gemini did not return an image for background removal');

    return Buffer.from(generatedPart.inlineData.data, 'base64');
  } catch (error) {
    console.error('Gemini BG Removal Error:', error);
    throw error;
  }
};
