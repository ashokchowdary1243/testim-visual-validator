const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

module.exports = async (req, res) => {
  // CORS Headers
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

  let { image, testName, threshold = 0.1 } = req.body;

  if (!image || !testName) {
    return res.status(400).json({ error: "Missing image or testName payload" });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    console.log(`[START] Processing validation for: ${testName}`);

    // --- STEP 1: Incoming Image Clean and Buffer Conversion ---
    // ఒకవేళ టెస్టిమ్ నుండి వచ్చే స్ట్రింగ్ లో JSON క్యారెక్టర్స్ ఉంటే క్లీన్ చేస్తుంది
    let cleanIncomingBase64 = image.trim();
    if (cleanIncomingBase64.startsWith('"') && cleanIncomingBase64.endsWith('"')) {
       cleanIncomingBase64 = cleanIncomingBase64.slice(1, -1);
    }
    cleanIncomingBase64 = cleanIncomingBase64.replace(/^data:image\/png;base64,/, "").replace(/\s/g, "");
    
    const currentBuffer = Buffer.from(cleanIncomingBase64, "base64");

    // --- STEP 2: Fetch Base Image Safely ---
    let baseFile;
    try {
      baseFile = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `base-images/${testName}.png`,
      });
    } catch (gitErr) {
      if (gitErr.status === 404) {
        return res.status(404).json({ error: `Base image NOT found for '${testName}'. Please run with IS_FIRST_RUN = true once.` });
      }
      throw gitErr;
    }

    const baseCleaned = baseFile.data.content.replace(/\s/g, "");
    const baseBuffer = Buffer.from(baseCleaned, "base64");

    // --- STEP 3: Safe PNG Parsing ---
    let basePng, currentPng;
    try {
      basePng = PNG.sync.read(baseBuffer);
    } catch (err) {
      return res.status(400).json({ error: "GitHub Base Image stream parsing corrupted. Re-upload base image." });
    }

    try {
      currentPng = PNG.sync.read(currentBuffer);
    } catch (parseError) {
      console.error("PNG Parse Crash Log:", parseError.message);
      return res.status(400).json({ 
        error: "PNG standard stream decoding failed. Testim image payload is corrupted.",
        details: parseError.message,
        stringSample: cleanIncomingBase64.substring(0, 50) + "..." // ఎర్రర్ ట్రాక్ చేయడానికి శాంపిల్
      });
    }

    const width = basePng.width;
    const height = basePng.height;

    if (currentPng.width !== width || currentPng.height !== height) {
      return res.status(400).json({
        error: `Size mismatch! Base: ${width}x${height}, Current: ${currentPng.width}x${currentPng.height}.`
      });
    }

    // --- STEP 4: Save Current Image to Git (క్రాష్ అవ్వకుండా పార్స్ అయ్యాకే సేవ్ చేయాలి) ---
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
      content: cleanIncomingBase64,
      ...(currentSha && { sha: currentSha }),
    });

    // --- STEP 5: Pixelmatch Execution ---
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

    // --- STEP 6: Upload Diff markers if failed ---
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
    console.error("Fatal loop:", err.message);
    return res.status(500).json({ error: err.message });
  }
};