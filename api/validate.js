const { Octokit } = require("@octokit/rest");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { image, testName } = req.body;

  try {
    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // current-images lo existing file SHA fetch cheyyi
    let sha;
    try {
      const existing = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `current-images/${testName}.png`,
      });
      sha = existing.data.sha;
      console.log('Existing current-image found, sha:', sha);
    } catch (e) {
      console.log('No existing current-image — creating new');
    }

    // Screenshot save cheyyi (sha tho)
    await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `current-images/${testName}.png`,
      message: "update screenshot",
      content: image,
      ...(sha && { sha }), // sha unte pass cheyyi, lekapothe skip
    });

    console.log('Current image saved successfully');

    // GitHub Action trigger cheyyi
    const dispatchRes = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/actions/workflows/compare.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      }
    );

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      console.log('Dispatch failed:', dispatchRes.status, errText);
      return res.status(500).json({ error: `Workflow dispatch failed: ${errText}` });
    }

    console.log('GitHub Action triggered successfully');

    res.json({
      success: true,
      message: "Validation triggered",
    });

  } catch (err) {
    console.log('Full error:', err.message);
    res.status(500).json({
      error: err.message,
      stack: err.stack,
    });
  }
};