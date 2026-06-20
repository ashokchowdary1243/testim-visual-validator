const { Octokit } = require("@octokit/rest");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    // Debug — env variables check cheyyi
    console.log('GITHUB_TOKEN exists:', !!process.env.GITHUB_TOKEN);
    console.log('GITHUB_OWNER:', process.env.GITHUB_OWNER);
    console.log('GITHUB_REPO:', process.env.GITHUB_REPO);

    const { image, testName } = req.body;
    
    console.log('testName:', testName);
    console.log('image length:', image?.length);

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    let sha;
    try {
      const existing = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `base-images/${testName}.png`,
      });
      sha = existing.data.sha;
    } catch (e) {
      console.log('No existing file — creating new');
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `base-images/${testName}.png`,
      message: `Save base image ${testName}`,
      content: image,
      sha,
    });

    res.status(200).json({
      success: true,
      message: "Base image saved",
    });
  } catch (err) {
    console.log('Full error:', err.message);
    res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
};