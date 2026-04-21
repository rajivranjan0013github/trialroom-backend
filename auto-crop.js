import sharp from 'sharp';
import path from 'path';

async function autoCrop() {
  try {
    const inputPath = '/Volumes/SSD500/Rajiv/Project/Trail-Room-Backend/img2-no-bg.png';
    const outputPath = '/Volumes/SSD500/Rajiv/Project/Trail-Room-Backend/output-cropped.png';

    console.log(`📂 Processing: ${inputPath}`);

    const image = sharp(inputPath);
    const metadata = await image.metadata();

    // 1. Detect tight boundaries
    console.log('⏳ Detecting boundaries...');
    const { data: trimmedBuffer, info: trimmedInfo } = await image
      .trim({ threshold: 30 }) 
      .toBuffer({ resolveWithObject: true });

    // 2. Define Margins
    // Following user request: Bottom 1%, Top/Sides 6% (for better balance)
    const marginV = Math.round(trimmedInfo.height * 0.06); // Top
    const marginH = Math.round(trimmedInfo.width * 0.06);  // Sides
    const marginB = Math.round(trimmedInfo.height * 0.01); // Bottom (User requested 1%)

    // 3. Calculate initial box with these margins
    let currentWidth = trimmedInfo.width + (marginH * 2);
    let currentHeight = trimmedInfo.height + marginV + marginB;

    // 4. Adjust to 4:5 Aspect Ratio (Width:Height = 0.8)
    const targetAspect = 4 / 5;
    let finalWidth = currentWidth;
    let finalHeight = currentHeight;

    if (finalWidth / finalHeight > targetAspect) {
      // Too wide for 4:5, add height
      finalHeight = Math.round(finalWidth / targetAspect);
    } else {
      // Too tall for 4:5, add width
      finalWidth = Math.round(finalHeight * targetAspect);
    }

    // 5. Calculate final padding
    // We try to keep our explicit margins, and any extra required for 4:5 is split
    const extraWidth = finalWidth - (trimmedInfo.width + (marginH * 2));
    const extraHeight = finalHeight - (trimmedInfo.height + marginV + marginB);

    const padLeft = marginH + Math.floor(extraWidth / 2);
    const padRight = finalWidth - trimmedInfo.width - padLeft;
    const padTop = marginV + Math.floor(extraHeight / 2);
    const padBottom = finalHeight - trimmedInfo.height - padTop;

    console.log(`📐 Adjusting to 4:5 aspect ratio with 1% bottom margin...`);
    
    // 6. Extend and Flatten (Add White Background)
    const finalImage = await sharp(trimmedBuffer)
      .extend({
        top: padTop,
        bottom: padBottom,
        left: padLeft,
        right: padRight,
        background: { r: 255, g: 255, b: 255 } 
      })
      .flatten({ background: '#ffffff' })
      .toBuffer({ resolveWithObject: true });

    // Calculate normalized box [ymin, xmin, ymax, xmax] (0-1000) for UI
    const box_2d = [
      Math.max(0, ((trimmedInfo.trimOffsetTop - padTop) / metadata.height) * 1000),
      Math.max(0, ((trimmedInfo.trimOffsetLeft - padLeft) / metadata.width) * 1000),
      Math.min(1000, ((trimmedInfo.trimOffsetTop + trimmedInfo.height + padBottom) / metadata.height) * 1000),
      Math.min(1000, ((trimmedInfo.trimOffsetLeft + trimmedInfo.width + padRight) / metadata.width) * 1000)
    ];

    console.log('✅ Auto-Crop Coordinates (0-1000):', box_2d);
    console.log(`📏 Original: ${metadata.width}x${metadata.height} -> Final (4:5): ${finalImage.info.width}x${finalImage.info.height}`);

    // Save the final buffer
    await sharp(finalImage.data).toFile(outputPath);
    
    console.log(`💾 4:5 cropped image saved to: ${outputPath}`);
  } catch (error) {
    console.error('❌ Error during auto-crop:', error.message);
    if (error.message.includes('Input Buffer is empty')) {
       console.log('💡 Tip: Make sure output-no-bg.png exists and has a transparent background.');
    }
  }
}

autoCrop();
