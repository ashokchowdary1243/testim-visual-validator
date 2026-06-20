// api/save-base.js
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
    const { image, testName } = req.body;

    if (!image || !testName) {
      return res.status(400).json({ error: 'Missing image or testName' });
    }

    // Remove data:image/png;base64, prefix if present
    const base64Data = image.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Create base-images directory if it doesn't exist
    const baseDir = path.join(process.cwd(), 'base-images');
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // Save the image
    const filePath = path.join(baseDir, `${testName}.png`);
    fs.writeFileSync(filePath, buffer);

    console.log(`Base image saved for test: ${testName}, size: ${buffer.length} bytes`);

    return res.status(200).json({
      success: true,
      message: `Base image saved for test: ${testName}`,
      path: filePath,
      size: buffer.length
    });

  } catch (error) {
    console.error('Save error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}