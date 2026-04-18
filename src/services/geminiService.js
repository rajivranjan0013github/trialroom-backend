import { GoogleGenerativeAI } from '@google/generative-ai';
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

    const prompt = `Copy identity from the first image that is mine. Copy fashion style from the second image. Now give me a new image. Make sure to maintain character consistency of the first image. Must give me the image with white background in 1080x1440 resolution.`;

    const result = await model.generateContent([
      prompt,
      ...validPersonImages,
      ...outfitPrompts
    ]);

    const generatedPart = result.response.candidates[0].content.parts.find(p => p.inlineData);
    if (!generatedPart) throw new Error('Gemini did not return a generated image');

    const rawBuffer = Buffer.from(generatedPart.inlineData.data, 'base64');

    // 3. Return the buffer directly from Gemini
    console.log(`Returning direct Gemini output...`);
    return rawBuffer;
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
