import { generateFittingImageMulti, detectFashionItems, removeBackgroundGemini } from '../services/geminiService.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';
import Fitting from '../models/Fitting.js';
import fs from 'fs/promises';
import path from 'path';

const MOCK_MODE = process.env.MOCK_MODE === 'true';



export const generateFitting = async (req, res) => {
  try {
    const { personUrls } = req.body;
    const outfitFiles = req.files;
    
    const urls = JSON.parse(personUrls || '[]');
    
    if (urls.length === 0 || !outfitFiles || outfitFiles.length === 0) {
      return res.status(400).json({ status: 'Error', message: 'Person References and Outfit Images are required' });
    }

    // ── DIAGNOSTIC: Save inputs to gptfolder for testing ──
    const gptFolder = path.join(process.cwd(), 'gptfolder');
    await fs.mkdir(gptFolder, { recursive: true });
    
    // Save outfits
    await Promise.all(outfitFiles.map((file, i) => 
      fs.writeFile(path.join(gptFolder, `outfit_${i}.png`), file.buffer)
    ));
    
    // Save person references (fetch from URLs)
    await Promise.all(urls.map(async (url, i) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(path.join(gptFolder, `person_${i}.jpg`), buffer);
      } catch (e) {
        console.error(`[Diagnostic] Failed to save person image ${i}:`, e.message);
      }
    }));
    
    console.log('📸 Diagnostic images saved to gptfolder.');

    // Skip all R2 uploads in mock mode — serve output-image.png directly from this server
    if (MOCK_MODE) {
      const host = req.get('host'); // e.g. "10.75.113.78:5001"
      console.log('🧪 MOCK MODE: skipping R2, returning local static URL');
      return res.json({
        status: 'Success',
        imageUrl: `http://${host}/static/output-image.png`,
        outfitUrls: [],
        data: null,
      });
    }

    // Skip AI call for now as requested
    const host = req.get('host');
    return res.json({
      status: 'Success',
      message: 'Diagnostic mode: Images saved to gptfolder. AI call skipped.',
      imageUrl: `http://${host}/static/output-image.png`, 
      outfitUrls: [],
    });

    /* ── ORIGINAL LOGIC BYPASSED ──
    // 1. Upload ALL Outfit images to R2
    const outfitUrls = await Promise.all(outfitFiles.map(async (file) => {
      const fileName = `outfits/${Date.now()}-${file.originalname}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype
      }));
      return `${process.env.R2_PUBLIC_DOMAIN}/${fileName}`;
    }));

    // 2. Generate Image using Gemini 3.1
    const generatedBuffer = await generateFittingImageMulti(
      urls,             
      outfitFiles, 
    );

    // 3. Upload AI result to R2
    const resultFileName = `results/${Date.now()}-fitting.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: resultFileName,
      Body: generatedBuffer,
      ContentType: 'image/png'
    }));
    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN}/${resultFileName}`;

    // 4. SAVE COMPLETE HISTORY
    const newFitting = await Fitting.create({
      user: req.user,
      personReferences: urls,
      outfitImages: outfitUrls, // Saving the full array now!
      resultImage: resultUrl
    });

    res.json({
      status: 'Success',
      imageUrl: resultUrl,
      outfitUrls: outfitUrls,
      data: newFitting
    });
    */
  } catch (error) {
    console.error('Generation Error:', error);
    res.status(500).json({ status: 'Error', message: 'Generation failed', detail: error.message });
  }
};

export const getFittingHistory = async (req, res) => {
  try {
    const history = await Fitting.find({ user: req.user }).sort({ createdAt: -1 });
    res.json({ status: 'Success', data: history });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};

export const detectOutfits = async (req, res) => {
  try {
    const outfitFile = req.file;
    if (!outfitFile) {
      return res.status(400).json({ status: 'Error', message: 'Outfit Image is required' });
    }

    const detectionResult = await detectFashionItems(outfitFile.buffer, outfitFile.mimetype);

    res.json({
      status: 'Success',
      data: detectionResult.items
    });
  } catch (error) {
    console.error('Detection Error:', error);
    res.status(500).json({ status: 'Error', message: 'Detection failed', detail: error.message });
  }
};

export const removeBackground = async (req, res) => {
  try {
    const originalFile = req.file;
    if (!originalFile) {
      return res.status(400).json({ status: 'Error', message: 'Image is required' });
    }

    // 1. Process Background Removal using Gemini
    console.log('--- REQ: removeBackground hit ---');
    console.log('✨ Removing background with Gemini...');
    
    const processedBuffer = await removeBackgroundGemini(originalFile.buffer, originalFile.mimetype);

    // 2. Upload processed image to R2
    const fileName = `processed/${Date.now()}-no-bg.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: processedBuffer,
      ContentType: 'image/png'
    }));

    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, "")}/${fileName}`;

    res.json({
      status: 'Success',
      url: resultUrl
    });
  } catch (error) {
    console.error('Background Removal Error:', error);
    res.status(500).json({ status: 'Error', message: 'Background removal failed', detail: error.message });
  }
};
export const modelifyController = async (req, res) => {
  try {
    const originalFile = req.file;
    if (!originalFile) {
      return res.status(400).json({ status: 'Error', message: 'Image is required' });
    }

    // 1. Process with Gemini (Enhance + Remove BG in one step)
    console.log('✨ Transforming into professional model with direct Gemini output...');
    const processedBuffer = await removeBackgroundGemini(originalFile.buffer, originalFile.mimetype);

    // 2. Upload to R2
    const fileName = `modelified/${Date.now()}-model.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: processedBuffer,
      ContentType: 'image/png'
    }));

    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, "")}/${fileName}`;

    res.json({
      status: 'Success',
      url: resultUrl
    });
  } catch (error) {
    console.error('Modelify Error:', error);
    res.status(500).json({ status: 'Error', message: 'Modelify failed', detail: error.message });
  }
};
