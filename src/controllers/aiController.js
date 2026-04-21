import { generateFittingImageMulti, detectFashionItems, removeBackgroundGemini } from '../services/geminiService.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';
import Fitting from '../models/Fitting.js';
import { removeBackground as imglyRemoveBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';

export const generateFitting = async (req, res) => {
  try {
    const { personUrls } = req.body;
    const outfitFiles = req.files;
    
    const urls = JSON.parse(personUrls || '[]');
    
    if (urls.length === 0 || !outfitFiles || outfitFiles.length === 0) {
      return res.status(400).json({ status: 'Error', message: 'Person References and Outfit Images are required' });
    }

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

    // 1. Process Background Removal using Gemini Prompt
    console.log('--- REQ: removeBackground hit ---');
    console.log('✨ Removing background and enhancing person with Gemini...');
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

export const streamScanner = async (req, res) => {
  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    const originalFile = req.file;
    if (!originalFile) {
      return res.status(400).json({ status: 'Error', message: 'Image is required' });
    }

    // Set SSE Headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log('🚀 Stream Scanner Started');
    console.log(`📂 File: ${originalFile.originalname}, Size: ${originalFile.size} bytes, Mime: ${originalFile.mimetype}`);

    // --- STAGE 0: Upload Original ---
    const origFileName = `scans/${Date.now()}-orig.jpg`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: origFileName,
      Body: originalFile.buffer,
      ContentType: originalFile.mimetype
    }));
    const origUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, "")}/${origFileName}`;
    sendEvent('ORIGINAL_UPLOADED', { url: origUrl });

    // --- STAGE 1: Background Removal (@imgly) ---
    console.log('⏳ Stage 1: Removing background with @imgly');
    
    const tempPath = path.join(process.cwd(), `temp-${Date.now()}.jpg`);
    await fs.writeFile(tempPath, originalFile.buffer);

    let bgRemovedBufferRaw;
    try {
      const bgRemovedBlob = await imglyRemoveBackground(tempPath, {
        output: { format: 'image/png' }
      });
      const bgRemovedArrayBuffer = await bgRemovedBlob.arrayBuffer();
      bgRemovedBufferRaw = Buffer.from(bgRemovedArrayBuffer);
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }

    // Upload the BG-removed image (transparent)
    const processedFileName = `scans/${Date.now()}-no-bg.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: processedFileName,
      Body: bgRemovedBufferRaw, 
      ContentType: 'image/png'
    }));
    const processedUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, "")}/${processedFileName}`;
    sendEvent('BG_REMOVED', { url: processedUrl });
    console.log('   ✅ Stage 1 complete');

    // --- STAGE 2: Compute focal region centered on person ---
    const origMeta = await sharp(bgRemovedBufferRaw).metadata();

    const { data: trimmedBuffer, info: trimmedInfo } = await sharp(bgRemovedBufferRaw)
      .trim({ threshold: 30 }) 
      .toBuffer({ resolveWithObject: true });

    // trimOffset values from sharp are NEGATIVE: they represent how far the 
    // trimmed image's origin moved from the original's origin.
    // So person starts at abs(trimOffsetLeft), abs(trimOffsetTop) in the original.
    const personLeft = Math.abs(trimmedInfo.trimOffsetLeft);
    const personTop = Math.abs(trimmedInfo.trimOffsetTop);
    const personW = trimmedInfo.width;
    const personH = trimmedInfo.height;
    const personRight = personLeft + personW;
    const personBottom = personTop + personH;



    // Person center
    const centerX = personLeft + personW / 2;
    const centerY = personTop + personH / 2;

    // Add breathing margins around person (asymmetric)
    const marginTop = 0.05;    // 5% headroom
    const marginOther = 0.02;  // 2% bottom, left, right
    let boxLeft = personLeft - personW * marginOther;
    let boxRight = personRight + personW * marginOther;
    let boxTop = personTop - personH * marginTop;
    let boxBottom = personBottom + personH * marginOther;
    let boxW = boxRight - boxLeft;
    let boxH = boxBottom - boxTop;

    // Enforce 4:5 aspect ratio (width:height)
    const targetAspect = 4 / 5;
    if (boxW / boxH > targetAspect) {
      // too wide, increase height (expand equally top/bottom)
      const newH = boxW / targetAspect;
      const diff = (newH - boxH) / 2;
      boxTop -= diff;
      boxBottom += diff;
      boxH = newH;
    } else {
      // too tall, increase width (expand equally left/right)
      const newW = boxH * targetAspect;
      const diff = (newW - boxW) / 2;
      boxLeft -= diff;
      boxRight += diff;
      boxW = newW;
    }

    // Clamp to image boundaries while preserving size
    if (boxLeft < 0) {
      boxRight += Math.abs(boxLeft);
      boxLeft = 0;
    }
    if (boxTop < 0) {
      boxBottom += Math.abs(boxTop);
      boxTop = 0;
    }
    if (boxRight > origMeta.width) {
      boxLeft = Math.max(0, boxLeft - (boxRight - origMeta.width));
      boxRight = origMeta.width;
    }
    if (boxBottom > origMeta.height) {
      boxTop = Math.max(0, boxTop - (boxBottom - origMeta.height));
      boxBottom = origMeta.height;
    }

    // Normalize to 0-1000
    const box = [
      (boxTop / origMeta.height) * 1000,    // ymin
      (boxLeft / origMeta.width) * 1000,     // xmin
      (boxBottom / origMeta.height) * 1000,  // ymax
      (boxRight / origMeta.width) * 1000,    // xmax
    ];



    sendEvent('CROP_BOX', { box, origWidth: origMeta.width, origHeight: origMeta.height });
    console.log('   ✅ Stage 2 complete');

    // --- STAGE 3: Fashion Detection (Gemini) ---
    console.log('⏳ Stage 3: Detecting fashion items');
    try {
      // Send the full bg-removed image — no background clutter, and
      // coordinates will directly match the displayed image
      const detectionResult = await detectFashionItems(bgRemovedBufferRaw, 'image/png');
      sendEvent('DETECTIONS', { items: detectionResult.items || [] });
      console.log('   ✅ Stage 3 complete — detected', (detectionResult.items || []).length, 'items');
    } catch (detErr) {
      console.error('   ⚠️ Stage 3 failed (non-fatal):', detErr.message);
      sendEvent('DETECTIONS', { items: [] });
    }

    res.end();
    console.log('✅ Stream Scanner Finished');

  } catch (error) {
    console.error('Stream Scanner Error:', error);
    sendEvent('ERROR', { message: error.message });
    res.end();
  }
};
