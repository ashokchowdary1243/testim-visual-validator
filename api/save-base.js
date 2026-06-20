// api/save-base.js
import { Octokit } from '@octokit/rest';

// Body size limit config
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, testName } = req.body;

    if (!image || !testName) {
      return res.status(400).json({ error: 'Missing image or testName' });
    }

    // GitHub token - Vercel environment variables నుండి తీసుకో
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
    }

    const octokit = new Octokit({ auth: githubToken });
    
    // GitHub repo details - ఇవి నీ దగ్గరకు మార్చు
    const owner = 'ashokchowdary1243'; // నీ GitHub username
    const repo = 'testim-visual-validator-new'; // నీ repo name
    const branch = 'main';
    const path = `base-images/${testName}.png`;

    // Remove base64 prefix if present
    const base64Data = image.replace(/^data:image\/png;base64,/, '');
    
    // Get existing file SHA if it exists (for update)
    let sha = null;
    try {
      const existingFile = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      sha = existingFile.data.sha;
    } catch (error) {
      // File doesn't exist, new file create చేయాలి
      if (error.status !== 404) {
        throw error;
      }
    }

    // Upload to GitHub
    const response = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: sha ? `Update base image for ${testName}` : `Add base image for ${testName}`,
      content: base64Data,
      branch,
      sha: sha || undefined,
    });

    console.log(`Base image saved to GitHub: ${path}`);

    return res.status(200).json({
      success: true,
      message: `Base image saved to GitHub for test: ${testName}`,
      path: path,
      sha: response.data.content.sha,
    });

  } catch (error) {
    console.error('Save error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}