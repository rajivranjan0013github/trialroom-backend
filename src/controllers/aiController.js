import { generateFittingImageMulti, detectFashionItems, removeBackgroundGemini } from '../services/geminiService.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';
import Fitting from '../models/Fitting.js';

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
