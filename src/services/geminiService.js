import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set in environment variables');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1440;

// Set MOCK_MODE=true in .env to use local output-image.png instead of calling Gemini
const MOCK_MODE = process.env.MOCK_MODE === 'true';

export const generateFittingImageMulti = async (personUrls, outfitFiles) => {
  try {
    if (MOCK_MODE) {
      console.log('🧪 MOCK MODE: Returning local output-image.png');
      const filePath = path.join(process.cwd(), 'output-image.png');
      return await fs.readFile(filePath);
    }

    // 1. Fetch person reference images (user's body/face)
    const personPrompts = await Promise.all(personUrls.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return {
        inlineData: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType: response.headers.get('content-type') || 'image/jpeg'
        }
      };
    }));
    const validPersonImages = personPrompts.filter(p => p !== null);

    if (validPersonImages.length === 0) {
      throw new Error('No valid person reference images could be fetched');
    }

    // 2. Prepare outfit/model images (fashion references)
    const outfitPrompts = outfitFiles.map(file => ({
      inlineData: {
        data: file.buffer.toString('base64'),
        mimeType: file.mimetype
      }
    }));

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-image',
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      }
    });

    const prompt = `Copy identity from the first image that is mine. Copy fashion style from the second image. Now give me a new image. Make sure to maintain character consistency of the first image. Must give me the image with white background.`;

    const result = await model.generateContent([
      prompt,
      ...validPersonImages,
      ...outfitPrompts
    ]);

    const generatedPart = result.response.candidates[0].content.parts.find(p => p.inlineData);
    if (!generatedPart) throw new Error('Gemini did not return a generated image');

    const rawBuffer = Buffer.from(generatedPart.inlineData.data, 'base64');

    // 3. Resize to 1080×1440, centered on a WHITE canvas (no bg removal)
    console.log(`Resizing to ${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}...`);
    const finalBuffer = await sharp(rawBuffer)
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .png()
      .toBuffer();

    return finalBuffer;
  } catch (error) {
    console.error('Gemini Style Transfer Error:', error);
    throw error;
  }
};

export const detectFashionItems = async (fileBuffer, mimeType) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        responseMimeType: "application/json",
      }
    });

    const prompt = `Return a JSON list of fashion items and accessories detected in the image. 
    Include: outfits, neckless, watch, footwear, hats, glasses, bags, etc.
    For each item, provide:
    - "label": a short descriptive name (e.g., "Silver Watch", "Red Dress")
    - "box_2d": [ymin, xmin, ymax, xmax] coordinates normalized to 1000.
    
    Format:
    {
      "items": [
        { "label": "string", "box_2d": [number, number, number, number] }
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
    return JSON.parse(text);
  } catch (error) {
    console.error('Gemini Detection Error:', error);
    throw error;
  }
};
