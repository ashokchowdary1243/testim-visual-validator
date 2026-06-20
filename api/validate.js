const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

module.exports = async (req, res) => {
  // CORS Headers handling (Testim sandbox nundi requests block avvakunda)
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { image, testName, threshold = 0.1 } = req.body;

  if (!image || !testName) {
    return res.status(400).json({ error: "Missing image or testName payload" });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    console.log(`[START] Processing validation for test: ${testName}`);

    // 1. Fetch Base Image from GitHub
    console.log("Fetching base image from GitHub...");
    const baseFile = await octokit.repos.getContent({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `base-images/${testName}.png`,
    });

    // GitHub base64 chunk breaks ని clean చేయడం (Very Important)
    const baseCleaned = baseFile.data.content.replace(/\s/g, "");
    const baseBuffer = Buffer.from(baseCleaned, "base64");

    // 2. Fetch or Check Current Image SHA for replacement
    let currentSha;
    try {
      const existing = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `current-images/${testName}.png`,
      });
      currentSha = existing.data.sha;
    } catch (e) {
      console.log("No existing current image found, creating fresh entry.");
    }

    // 3. Save incoming Current Image to GitHub (current-images/)
    console.log("Saving new current image to GitHub...");
    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `current-images/${testName}.png`,
      message: `Update current screenshot for ${testName}`,
      content: image,
      ...(currentSha && { sha: currentSha }),
    });

    // 4. Parse Buffers into PNG format to compare pixels
    const basePng = PNG.sync.read(baseBuffer);
    const currentPng = PNG.sync.read(Buffer.from(image, "base64"));

    const width = basePng.width;
    const height = basePng.height;

    // Dimensions check
    if (currentPng.width !== width || currentPng.height !== height) {
      return res.status(400).json({
        error: `Size mismatch! Base: ${width}x${height}, Current: ${currentPng.width}x${currentPng.height}. Run with IS_FIRST_RUN=true to reset base image.`,
      });
    }

    // 5. Compare using Pixelmatch
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
    const parsedDiffPercent = parseFloat(diffPercentage);
    
    // threshold ratio check (e.g., 0.1%)
    const pass = parsedDiffPercent <= threshold;

    console.log(`Result -> Mismatched Pixels: ${mismatchedPixels} (${diffPercentage}%)`);

    // 6. If comparison FAILS, upload Diff Image highlighter to GitHub
    if (!pass) {
      console.log("Validation failed. Uploading diff matrix to GitHub...");
      let diffSha;
      try {
        const existingDiff = await octokit.repos.getContent({
          owner: process.env.GITHUB_OWNER,
          repo: process.env.GITHUB_REPO,
          path: `diff-images/${testName}.png`,
        });
        diffSha = existingDiff.data.sha;
      } catch (e) {}

      await octokit.repos.createOrUpdateFileContents({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `diff-images/${testName}.png`,
        message: `Visual differences highlighted for ${testName}`,
        content: PNG.sync.write(diff).toString("base64"),
        ...(diffSha && { sha: diffSha }),
      });
    }

    return res.status(200).json({
      pass,
      diffPercentage: parsedDiffPercent,
      mismatchedPixels,
      totalPixels,
      message: pass
        ? `PASS - Images match completely (${diffPercentage}% diff)`
        : `FAIL - Visual mismatch detected: ${diffPercentage}%. Check diff-images/ folder in GitHub.`,
    });

  } catch (err) {
    console.error("Backend Error Logs:", err.message);
    return res.status(500).json({ error: err.message });
  }
};