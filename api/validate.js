const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");
const Jimp = require("jimp");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  let { image, testName, threshold = 0.1 } = req.body;

  if (!image || !testName) {
    return res.status(400).json({ error: "Missing image or testName" });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    console.log(`Processing validation for: ${testName}`);

    // Base image fetch cheyyi
    let baseFile;
    try {
      baseFile = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `base-images/${testName}.png`,
      });
    } catch (gitErr) {
      if (gitErr.status === 404) {
        return res.status(404).json({
          error: `Base image not found for '${testName}'. IS_FIRST_RUN = true tho run cheyyi!`
        });
      }
      throw gitErr;
    }

    // Base image — already PNG ga save chesamu
    const baseCleaned = baseFile.data.content.replace(/\s/g, "");
    const baseBuffer = Buffer.from(baseCleaned, "base64");

    // Current image — JPEG → PNG convert cheyyi
    const incomingCleaned = image.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "");
    const currentJimp = await Jimp.read(Buffer.from(incomingCleaned, "base64"));

    // Base image size teesuko
    const basePng = PNG.sync.read(baseBuffer);
    const width = basePng.width;
    const height = basePng.height;

    // Current image ni same size ki resize cheyyi
    currentJimp.resize(width, height);
    const currentPngBuffer = await currentJimp.getBufferAsync(Jimp.MIME_PNG);
    const currentPng = PNG.sync.read(currentPngBuffer);

    console.log(`Size: ${width}x${height}`);

    // Pixel compare cheyyi
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

    console.log(`Diff: ${diffPercentage}%, Pass: ${pass}`);

    // Fail aite diff image save cheyyi
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
        message: `Diff image for ${testName}`,
        content: PNG.sync.write(diff).toString("base64"),
        ...(diffSha && { sha: diffSha }),
      });

      console.log('Diff image saved to GitHub');
    }

    return res.status(200).json({
      pass,
      diffPercentage: parseFloat(diffPercentage),
      mismatchedPixels,
      totalPixels,
      message: pass
        ? `PASS - Images match! (${diffPercentage}% diff)`
        : `FAIL - ${diffPercentage}% difference! Check diff-images/ in GitHub.`
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};