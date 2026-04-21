import { removeBackground } from '@imgly/background-removal-node';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

async function main() {
  try {
    const inputPath = '/Volumes/SSD500/Rajiv/Project/Trail-Room-Backend/image2.jpg';
    const outputPath = '/Volumes/SSD500/Rajiv/Project/Trail-Room-Backend/img2-no-bg.png';

    console.log(`📂 Loading image from: ${inputPath}`);

    console.log('⏳ Removing background (this may take a moment)...');
    
    const config = {
      output: {
        format: 'image/png',
        quality: 0.8
      }
    };

    const resultBlob = await removeBackground(inputPath, config);
    const arrayBuffer = await resultBlob.arrayBuffer();
    const resultBuffer = Buffer.from(arrayBuffer);

    await fs.writeFile(outputPath, resultBuffer);
    
    console.log(`✅ Success! Saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
