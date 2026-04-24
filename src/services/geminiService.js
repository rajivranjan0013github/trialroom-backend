import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI, { toFile } from 'openai';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Detection Cache (saves Gemini API costs during dev/testing) ──
const CACHE_DIR = path.join(process.cwd(), '.cache', 'detections');

async function getCachedDetection(hash) {
  try {
    const filePath = path.join(CACHE_DIR, `${hash}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    console.log(`[Cache] HIT — returning cached detection for ${hash}`);
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveCachedDetection(hash, result) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const filePath = path.join(CACHE_DIR, `${hash}.json`);
    await fs.writeFile(filePath, JSON.stringify(result, null, 2));
    console.log(`[Cache] SAVED detection result for ${hash}`);
  } catch (err) {
    console.warn('[Cache] Failed to save:', err.message);
  }
}


export const generateFittingImageMulti = async (personUrls, outfitFiles, selectedItems = []) => {
  try {
    // 1. Fetch person reference images from URLs
    const personBuffers = await Promise.all(personUrls.map(async (url) => {
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

    console.log('[OpenAI] Calling gpt-image-1 for virtual try-on...');
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

    console.log('[OpenAI] gpt-image-1 generation complete');
    return buffer;
  } catch (error) {
    console.error('OpenAI Style Transfer Error:', error);
    throw error;
  }
};

export const detectFashionItems = async (fileBuffer, mimeType) => {
  try {
    // Check cache first
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const cached = await getCachedDetection(hash);
    if (cached) return cached;

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: "application/json",
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

    // Save to cache
    await saveCachedDetection(hash, parsed);

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
