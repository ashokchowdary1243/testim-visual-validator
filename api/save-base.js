const { Octokit } = require("@octokit/rest");
const Jimp = require("jimp");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    const { image, testName } = req.body;

    if (!image || !testName) {
      return res.status(400).json({ error: "Missing image or testName" });
    }

    console.log('testName:', testName);
    console.log('image length:', image?.length);

    // JPEG → PNG convert cheyyi
    const inputBuffer = Buffer.from(image, "base64");
    const jimp = await Jimp.read(inputBuffer);
    const pngBuffer = await jimp.getBufferAsync(Jimp.MIME_PNG);
    const pngBase64 = pngBuffer.toString("base64");

    console.log('PNG converted length:', pngBase64.length);

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    let sha;
    try {
      const existing = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `base-images/${testName}.png`,
      });
      sha = existing.data.sha;
      console.log('Existing file found — updating');
    } catch (e) {
      console.log('No existing file — creating new');
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `base-images/${testName}.png`,
      message: `Save base image ${testName}`,
      content: pngBase64,
      sha,
    });

    return res.status(200).json({
      success: true,
      message: `Base image saved as PNG: ${testName}`
    });

  } catch (err) {
    console.log('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};