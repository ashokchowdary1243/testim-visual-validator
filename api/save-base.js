const { Octokit } = require("@octokit/rest");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    const { image, testName } = req.body;
    
    console.log('testName:', testName);
    console.log('image length:', image?.length);
    console.log('GITHUB_OWNER:', process.env.GITHUB_OWNER);
    console.log('GITHUB_REPO:', process.env.GITHUB_REPO);

    // Token check
    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).json({ error: "GITHUB_TOKEN not configured" });
    }

    const octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Remove data:image/png;base64, prefix if present
    const base64Content = image.replace(/^data:image\/png;base64,/, '');
    
    console.log('Base64 content length:', base64Content.length);

    // Get existing file SHA if it exists
    let sha;
    try {
      const existing = await octokit.repos.getContent({
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        path: `base-images/${testName}.png`,
      });
      sha = existing.data.sha;
      console.log('Existing file found, SHA:', sha);
    } catch (e) {
      console.log('No existing file — creating new');
      if (e.status !== 404) {
        console.log('Error checking existing file:', e.message);
      }
    }

    // Upload to GitHub - content should be base64 encoded string
    const response = await octokit.repos.createOrUpdateFileContents({
      owner: process.env.GITHUB_OWNER,
      repo: process.env.GITHUB_REPO,
      path: `base-images/${testName}.png`,
      message: `Save base image ${testName}`,
      content: base64Content,  // Direct base64 string
      sha: sha,
    });

    console.log('File saved successfully!');
    console.log('File SHA:', response.data.content.sha);

    res.status(200).json({
      success: true,
      message: "Base image saved",
      sha: response.data.content.sha,
    });

  } catch (err) {
    console.log('Full error:', err.message);
    console.log('Error status:', err.status);
    console.log('Error details:', err.response?.data);
    
    // Better error message
    let errorMessage = err.message;
    if (err.status === 404) {
      errorMessage = "Repository not found. Check GITHUB_OWNER and GITHUB_REPO";
    } else if (err.status === 401) {
      errorMessage = "Invalid GITHUB_TOKEN. Please check token permissions.";
    } else if (err.status === 403) {
      errorMessage = "Insufficient permissions. Token needs 'repo' scope.";
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: err.message
    });
  }
};

// Body size limit
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};