const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { image, testName, threshold = 0.1 } = req.body;

  try {
    // Token check
    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).json({ error: "GITHUB_TOKEN not configured" });
    }

    const octokit = new Octokit({ 
      auth: process.env.GITHUB_TOKEN 
    });

    // GitHub నుండి base image తీసుకో
    console.log('Fetching base image for:', testName);
    console.log('Owner:', process.env.GITHUB_OWNER);
    console.log('Repo:', process.env.GITHUB_REPO);

    const baseFile = await octokit.repos.getContent({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `base-images/${testName}.png`,
    });

    console.log('Base image fetched successfully');

    // Remove prefix if present
    const currentBase64 = image.replace(/^data:image\/png;base64,/, '');
    
    const baseBuffer = Buffer.from(baseFile.data.content, "base64");
    const currentBuffer = Buffer.from(currentBase64, "base64");

    console.log('Base image size:', baseBuffer.length);
    console.log('Current image size:', currentBuffer.length);

    const basePng = PNG.sync.read(baseBuffer);
    const currentPng = PNG.sync.read(currentBuffer);

    console.log(`Base: ${basePng.width}x${basePng.height}`);
    console.log(`Current: ${currentPng.width}x${currentPng.height}`);

    const width = basePng.width;
    const height = basePng.height;

    if (currentPng.width !== width || currentPng.height !== height) {
      // Resize current image to match base
      const resized = new PNG({ width, height });
      const scaleX = currentPng.width / width;
      const scaleY = currentPng.height / height;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcX = Math.min(Math.floor(x * scaleX), currentPng.width - 1);
          const srcY = Math.min(Math.floor(y * scaleY), currentPng.height - 1);
          const srcIdx = (srcY * currentPng.width + srcX) * 4;
          const dstIdx = (y * width + x) * 4;
          resized.data[dstIdx] = currentPng.data[srcIdx];
          resized.data[dstIdx + 1] = currentPng.data[srcIdx + 1];
          resized.data[dstIdx + 2] = currentPng.data[srcIdx + 2];
          resized.data[dstIdx + 3] = currentPng.data[srcIdx + 3];
        }
      }
      currentPng.data = resized.data;
      currentPng.width = width;
      currentPng.height = height;
    }

    const diff = new PNG({ width, height });

    const mismatchedPixels = pixelmatch(
      basePng.data,
      currentPng.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );

    const totalPixels = width * height;
    const diffPercentage = ((mismatchedPixels / totalPixels) * 100);
    const pass = diffPercentage <= threshold;

    console.log(`Diff: ${mismatchedPixels} pixels (${diffPercentage.toFixed(2)}%)`);

    res.json({
      pass,
      diffPercentage: Math.round(diffPercentage * 100) / 100,
      mismatchedPixels,
      totalPixels,
      message: pass
        ? `PASS - Images match (${diffPercentage.toFixed(2)}% diff)`
        : `FAIL - ${diffPercentage.toFixed(2)}% difference detected!`,
    });

  } catch (err) {
    console.log("Error:", err.message);
    console.log("Error status:", err.status);
    console.log("Error details:", err.response?.data);
    
    let errorMessage = err.message;
    if (err.status === 404) {
      errorMessage = "Base image not found in GitHub. Please run with IS_FIRST_RUN=true first.";
    } else if (err.status === 401) {
      errorMessage = "Invalid GITHUB_TOKEN. Please check token permissions.";
    }
    
    res.status(500).json({ 
      pass: false,
      error: errorMessage,
      details: err.message 
    });
  }
};

// Body size limit 10mb
handler.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

module.exports = handler;