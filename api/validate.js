// api/validate.js
import { Octokit } from '@octokit/rest';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Body size limit config
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, testName, threshold = 0.1 } = req.body;

    if (!image || !testName) {
      return res.status(400).json({ error: 'Missing image or testName' });
    }

    // GitHub token
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
    }

    const octokit = new Octokit({ auth: githubToken });
    
    // GitHub repo details
    const owner = 'ashokchowdary1243'; // నీ GitHub username
    const repo = 'testim-visual-validator-new'; // నీ repo name
    const branch = 'main';
    const path = `base-images/${testName}.png`;

    // GitHub నుండి base image తీసుకో
    let baseImageBase64;
    try {
      const response = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      baseImageBase64 = response.data.content;
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ 
          pass: false, 
          error: 'Base image not found. Please run with IS_FIRST_RUN=true first.' 
        });
      }
      throw error;
    }

    // Remove base64 prefix if present
    const currentBase64 = image.replace(/^data:image\/png;base64,/, '');
    
    // Convert to buffers
    const baseBuffer = Buffer.from(baseImageBase64, 'base64');
    const currentBuffer = Buffer.from(currentBase64, 'base64');
    
    // Load images as PNG
    const basePng = PNG.sync.read(baseBuffer);
    const currentPng = PNG.sync.read(currentBuffer);

    // Resize if dimensions don't match
    if (basePng.width !== currentPng.width || basePng.height !== currentPng.height) {
      const resized = new PNG({ width: basePng.width, height: basePng.height });
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

    // Compare images
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