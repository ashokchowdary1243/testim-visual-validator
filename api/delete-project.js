const { Octokit } = require("@octokit/rest");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { projectName } = req.body;
  if (!projectName) return res.status(400).json({ error: "Missing projectName" });

  try {
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    // 1. Get all files in repo tree
    const { data: repoInfo } = await octokit.repos.get({ owner: OWNER, repo: REPO });
    const { data: refData } = await octokit.git.getRef({
      owner: OWNER, repo: REPO,
      ref: `heads/${repoInfo.default_branch}`
    });
    const { data: commitData } = await octokit.git.getCommit({
      owner: OWNER, repo: REPO,
      commit_sha: refData.object.sha
    });
    const { data: treeData } = await octokit.git.getTree({
      owner: OWNER, repo: REPO,
      tree_sha: commitData.tree.sha,
      recursive: true
    });

    // 2. Find all files belonging to this project
    const projectFiles = treeData.tree.filter(item =>
      item.type === 'blob' && (
        item.path.startsWith(`base-images/${projectName}/`) ||
        item.path.startsWith(`current-images/${projectName}/`) ||
        item.path.startsWith(`diff-images/${projectName}/`) ||
        item.path.startsWith(`reports/${projectName}/`)
      )
    );

    console.log(`Deleting ${projectFiles.length} files for project: ${projectName}`);

    // 3. Delete all files
    let deleted = 0;
    for (const file of projectFiles) {
      try {
        await octokit.repos.deleteFile({
          owner: OWNER, repo: REPO,
          path: file.path,
          message: `Delete project: ${projectName}`,
          sha: file.sha,
        });
        deleted++;
      } catch (e) {
        console.error(`Failed to delete ${file.path}: ${e.message}`);
      }
    }

    // 4. Update projects.json
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
    } catch (e) {}

    projects = projects.filter(p => p.name !== projectName);

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO,
      path: projectsPath,
      message: `Remove project: ${projectName}`,
      content: Buffer.from(JSON.stringify(projects, null, 2)).toString("base64"),
      ...(projectsSha && { sha: projectsSha }),
    });

    return res.status(200).json({
      success: true,
      deleted,
      message: `Project '${projectName}' deleted successfully`
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};