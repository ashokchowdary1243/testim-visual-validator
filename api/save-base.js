const { Octokit } = require("@octokit/rest");
const Jimp = require("jimp");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { image, testName, projectName } = req.body;
  if (!image || !testName || !projectName) {
    return res.status(400).json({ error: "Missing image, testName or projectName" });
  }

  try {
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    console.log(`Saving base: ${projectName}/${testName}`);

    // JPEG to PNG convert
    const inputBuffer = Buffer.from(image, "base64");
    const jimp = await Jimp.read(inputBuffer);
    const pngBuffer = await jimp.getBufferAsync(Jimp.MIME_PNG);
    const pngBase64 = pngBuffer.toString("base64");

    // Save base image
    let sha;
    try {
      const existing = await octokit.repos.getContent({
        owner: OWNER, repo: REPO,
        path: `base-images/${projectName}/${testName}.png`,
      });
      sha = existing.data.sha;
    } catch (e) {}

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO,
      path: `base-images/${projectName}/${testName}.png`,
      message: `Save base: ${projectName}/${testName}`,
      content: pngBase64,
      sha,
    });

    // Update projects.json
    const projectsPath = "reports/projects.json";
    let projects = [];
    let projectsSha;
    try {
      const existingProjects = await octokit.repos.getContent({
        owner: OWNER, repo: REPO, path: projectsPath,
      });
      projectsSha = existingProjects.data.sha;
      const decoded = Buffer.from(existingProjects.data.content.replace(/\s/g, ""), "base64").toString("utf8");
      projects = JSON.parse(decoded);
    } catch (e) {
      projects = [];
    }

    let project = projects.find(p => p.name === projectName);
    if (!project) {
      projects.push({ name: projectName, testNames: [testName] });
    } else if (!project.testNames.includes(testName)) {
      project.testNames.push(testName);
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO,
      path: projectsPath,
      message: `Update projects: ${projectName}/${testName}`,
      content: Buffer.from(JSON.stringify(projects, null, 2)).toString("base64"),
      ...(projectsSha && { sha: projectsSha }),
    });

    return res.status(200).json({
      success: true,
      message: `Base image saved: ${projectName}/${testName}`
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};