import { generateFittingImageMulti, detectFashionItems, removeBackgroundGemini, generateStandingAvatarOpenAI } from '../services/geminiService.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import s3Client, { bucketName } from '../utils/s3Config.js';
import Fitting from '../models/Fitting.js';

export const generateFitting = async (req, res) => {
  try {
    const { personUrls } = req.body;
    const outfitFiles = req.files;

    const urls = JSON.parse(personUrls || '[]');
    const selectedItems = JSON.parse(req.body.selectedItems || '[]');
    const detectedItems = JSON.parse(req.body.detectedItems || '[]');
    const title = req.body.title || 'Virtual Look Synthesis';
    const category = req.body.category || 'Outfit';

    if (urls.length === 0 || !outfitFiles || outfitFiles.length === 0) {
      return res.status(400).json({ status: 'Error', message: 'Person References and Outfit Images are required' });
    }

    // 1. Upload outfit images to R2
    const outfitUrls = await Promise.all(outfitFiles.map(async (file) => {
      const fileName = `outfits/${Date.now()}-${file.originalname}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
      }));
      return `${process.env.R2_PUBLIC_DOMAIN}/${fileName}`;
    }));

    // 2. Generate fitting image via OpenAI
    const generatedBuffer = await generateFittingImageMulti(urls, outfitFiles, selectedItems);

    // 3. Upload AI result to R2
    const resultFileName = `results/${Date.now()}-fitting.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: resultFileName,
      Body: generatedBuffer,
      ContentType: 'image/png',
    }));
    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN}/${resultFileName}`;

    // 4. Save to database
    const newFitting = await Fitting.create({
      user: req.user,
      personReferences: urls,
      outfitImages: outfitUrls,
      detectedItems,
      selectedItems,
      title,
      category,
      resultImage: resultUrl,
    });

    res.json({
      status: 'Success',
      imageUrl: resultUrl,
      outfitUrls,
      data: newFitting,
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
      data: detectionResult.items,
      suggestedTitle: detectionResult.suggestedTitle,
      category: detectionResult.category,
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

    console.log('✨ Removing background with Gemini...');
    const processedBuffer = await removeBackgroundGemini(originalFile.buffer, originalFile.mimetype);

    const fileName = `processed/${Date.now()}-no-bg.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: processedBuffer,
      ContentType: 'image/png',
    }));

    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${fileName}`;

    res.json({ status: 'Success', url: resultUrl });
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

    console.log('✨ Transforming into professional model...');
    const processedBuffer = await removeBackgroundGemini(originalFile.buffer, originalFile.mimetype);

    const fileName = `modelified/${Date.now()}-model.png`;
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: processedBuffer,
      ContentType: 'image/png',
    }));

    const resultUrl = `${process.env.R2_PUBLIC_DOMAIN.replace(/\/$/, '')}/${fileName}`;

    res.json({ status: 'Success', url: resultUrl });
  } catch (error) {
    console.error('Modelify Error:', error);
    res.status(500).json({ status: 'Error', message: 'Modelify failed', detail: error.message });
  }
};
export const generateAvatar = async (req, res) => {
  try {
    const file = req.file;
    console.log("henrsate avatr");
    if (!file) {
      return res.status(400).json({ status: 'Error', message: 'Reference image is required' });
    }

    console.log('✨ Generating standing avatar for user:', req.user);
    const generatedBuffer = await generateStandingAvatarOpenAI(file.buffer, file.mimetype);
    const imageBase64 = generatedBuffer.toString('base64');

    res.json({ status: 'Success', imageBase64 });
  } catch (error) {
    console.error('Avatar Generation Error:', error);
    res.status(500).json({ status: 'Error', message: 'Avatar generation failed', detail: error.message });
  }
};

export const toggleFavorite = async (req, res) => {
  try {
    const { id } = req.params;
    const fitting = await Fitting.findOne({ _id: id, user: req.user });
    
    if (!fitting) {
      return res.status(404).json({ status: 'Error', message: 'Fitting not found' });
    }

    fitting.isFavorite = !fitting.isFavorite;
    await fitting.save();

    res.json({ status: 'Success', isFavorite: fitting.isFavorite });
  } catch (error) {
    res.status(500).json({ status: 'Error', message: error.message });
  }
};
