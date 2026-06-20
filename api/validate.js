const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

module.exports = async (req, res) => {
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

  // TEST_NAME 'boga-header-images_new' format lo clear ga clean cheyyి
  let { image, testName, threshold = 0.1 } = req.body;

  if (!image || !testName) {
    return res.status(400).json({ error: "Missing image or testName payload" });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    console.log(`[START] Processing validation for: ${testName}`);

    // 1. Fetch Base Image Safely
    let baseFile;
    try {
      baseFile = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `base-images/${testName}.png`,
      });
    } catch (gitErr) {
      if (gitErr.status === 404) {
        return res.status(404).json({ error: `Base image NOT found for '${testName}'. Run first run once.` });
      }
      throw gitErr;
    }

    // 2. Clear Base64 Strings (Whitespace and Data Prefixes)
    const baseCleaned = baseFile.data.content.replace(/\s/g, "");
    const baseBuffer = Buffer.from(baseCleaned, "base64");

    // Live incoming image string format cleaning
    const incomingCleaned = image.replace(/^data:image\/png;base64,/, "").replace(/\s/g, "");
    const currentBuffer = Buffer.from(incomingCleaned, "base64");

    // 3. Save Current Image to Git
    let currentSha;
    try {
      const existing = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `current-images/${testName}.png`,
      });
      currentSha = existing.data.sha;
    } catch (e) {}

    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `current-images/${testName}.png`,
      message: `Update current screenshot for ${testName}`,
      content: incomingCleaned, // Use clean text
      ...(currentSha && { sha: currentSha }),
    });

    // 4. Safe Parse Buffer using try-catch to spot stream breaking
    let basePng, currentPng;
    try {
      basePng = PNG.sync.read(baseBuffer);
      currentPng = PNG.sync.read(currentBuffer);
    } catch (parseError) {
      console.error("PNG Parse Crash:", parseError.message);
      return res.status(400).json({ 
        error: "PNG standard stream decoding failed. Check if image format is pure base64.",
        details: parseError.message 
      });
    }

    const width = basePng.width;
    const height = basePng.height;

    if (currentPng.width !== width || currentPng.height !== height) {
      return res.status(400).json({
        error: `Size mismatch! Base: ${width}x${height}, Current: ${currentPng.width}x${currentPng.height}.`
      });
    }

    // 5. Pixelmatch execution block
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
    const pass = parsedDiffPercent <= threshold;

    // 6. If mismatch, save diff markers to Git repo
    if (!pass) {
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
        message: `Visual markers for ${testName}`,
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
        ? `PASS - Pure match (${diffPercentage}% diff)`
        : `FAIL - Visual mismatch: ${diffPercentage}%. View diff-images/ folder.`,
    });

  } catch (err) {
    console.error("Fatal exception loop:", err.message);
    return res.status(500).json({ error: err.message });
  }
};