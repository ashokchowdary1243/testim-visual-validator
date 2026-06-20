const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { image, testName, threshold = 0.1 } = req.body;

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const baseFile = await octokit.repos.getContent({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `base-images/${testName}.png`,
    });

    const baseBuffer = Buffer.from(baseFile.data.content, "base64");

    const basePng = PNG.sync.read(baseBuffer);
    const currentPng = PNG.sync.read(Buffer.from(image, "base64"));

    const width = basePng.width;
    const height = basePng.height;

    if (currentPng.width !== width || currentPng.height !== height) {
      return res.status(400).json({
        error: `Size mismatch! Base: ${width}x${height}, Current: ${currentPng.width}x${currentPng.height}`,
      });
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
    const diffPercentage = ((mismatchedPixels / totalPixels) * 100).toFixed(2);
    const pass = parseFloat(diffPercentage) <= threshold;

    console.log(`Diff: ${mismatchedPixels} pixels (${diffPercentage}%)`);

    res.json({
      pass,
      diffPercentage: parseFloat(diffPercentage),
      mismatchedPixels,
      totalPixels,
      message: pass
        ? `PASS - Images match (${diffPercentage}% diff)`
        : `FAIL - ${diffPercentage}% difference detected!`,
    });

  } catch (err) {
    console.log("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Body size limit 10mb — Vercel config
handler.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

module.exports = handler;