// api/validate.js
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

// Body size limit config - ఇది important
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS headers - Testim నుండి requests రావడానికి
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // OPTIONS request handle చేయి (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only POST requests allow చేయి
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, testName, threshold = 0.1 } = req.body;

    if (!image || !testName) {
      return res.status(400).json({ error: 'Missing image or testName' });
    }

    // Base image path
    const baseImagePath = path.join(process.cwd(), 'base-images', `${testName}.png`);
    
    // Check if base image exists
    if (!fs.existsSync(baseImagePath)) {
      return res.status(404).json({ 
        pass: false, 
        error: 'Base image not found. Please run with IS_FIRST_RUN=true first.' 
      });
    }

    // Convert base64 to buffer
    const base64Data = image.replace(/^data:image\/png;base64,/, '');
    const currentBuffer = Buffer.from(base64Data, 'base64');
    
    // Read base image
    const baseBuffer = fs.readFileSync(baseImagePath);
    
    // Load images as PNG
    const basePng = PNG.sync.read(baseBuffer);
    const currentPng = PNG.sync.read(currentBuffer);

    // Resize if dimensions don't match
    if (basePng.width !== currentPng.width || basePng.height !== currentPng.height) {
      // Resize current image to match base image dimensions
      const resized = new PNG({ width: basePng.width, height: basePng.height });
      // Simple resize - you might want to use a better algorithm
      const scaleX = currentPng.width / basePng.width;
      const scaleY = currentPng.height / basePng.height;
      
      for (let y = 0; y < basePng.height; y++) {
        for (let x = 0; x < basePng.width; x++) {
          const srcX = Math.min(Math.floor(x * scaleX), currentPng.width - 1);
          const srcY = Math.min(Math.floor(y * scaleY), currentPng.height - 1);
          const srcIdx = (srcY * currentPng.width + srcX) * 4;
          const dstIdx = (y * basePng.width + x) * 4;
          resized.data[dstIdx] = currentPng.data[srcIdx];
          resized.data[dstIdx + 1] = currentPng.data[srcIdx + 1];
          resized.data[dstIdx + 2] = currentPng.data[srcIdx + 2];
          resized.data[dstIdx + 3] = currentPng.data[srcIdx + 3];
        }
      }
      currentPng.data = resized.data;
      currentPng.width = basePng.width;
      currentPng.height = basePng.height;
    }

    // Compare images using pixelmatch
    const diff = new PNG({ width: basePng.width, height: basePng.height });
    const numDiffPixels = pixelmatch(
      basePng.data,
      currentPng.data,
      diff.data,
      basePng.width,
      basePng.height,
      { threshold: 0.1 }
    );

    const totalPixels = basePng.width * basePng.height;
    const diffPercentage = (numDiffPixels / totalPixels) * 100;
    const pass = diffPercentage <= threshold;

    // Save diff image for debugging (optional)
    if (!pass) {
      const diffPath = path.join(process.cwd(), 'diffs', `${testName}-${Date.now()}.png`);
      const diffDir = path.dirname(diffPath);
      if (!fs.existsSync(diffDir)) {
        fs.mkdirSync(diffDir, { recursive: true });
      }
      fs.writeFileSync(diffPath, PNG.sync.write(diff));
    }

    return res.status(200).json({
      pass,
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      message: pass ? 'Images match!' : `Images differ by ${diffPercentage}%`,
      totalPixels,
      diffPixels: numDiffPixels
    });

  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({ 
      pass: false, 
      error: error.message 
    });
  }
}