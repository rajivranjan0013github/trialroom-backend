import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Ensure your key is in your environment variables
});

async function generateImage() {
  try {
    const response = await openai.images.generate({
      model: "gpt-image-2",
      prompt: "A futuristic greenhouse on Mars with bioluminescent plants, cinematic lighting, 8k.",
      n: 1,                 // Supports 1 to 8 images
      size: "1024×1536",     // Supports various aspect ratios (e.g., 9:16)
      quality: "low",      // Options: "low", "medium", "high"
    });

    // Save the base64 image data to a file
    const b64Data = response.data[0].b64_json;
    const buffer = Buffer.from(b64Data, 'base64');
    fs.writeFileSync('mars_greenhouse.png', buffer);

    console.log("Image saved successfully as mars_greenhouse.png");
  } catch (error) {
    console.error("Error generating image:", error);
  }
}

generateImage();
