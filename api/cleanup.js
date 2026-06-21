const { Octokit } = require("@octokit/rest");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { action, items } = req.body; // action: 'scan' | 'delete', items: [{path, sha}] for delete
  const OWNER = process.env.GITHUB_OWNER;
  const REPO = process.env.GITHUB_REPO;
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  try {
    // ───────────────────────────────────────────────────
    // DELETE: remove the given files (sha passed in from a prior scan,
    // so this needs exactly one API call per file)
    // ───────────────────────────────────────────────────
    if (action === 'delete') {
      if (!items || !items.length) {
        return res.status(400).json({ error: "No items provided" });
      }

      let deleted = 0;
      const errors = [];

      for (const item of items) {
        try {
          await octokit.repos.deleteFile({
            owner: OWNER, repo: REPO,
            path: item.path,
            message: `Cleanup: remove orphan image ${item.path}`,
            sha: item.sha,
          });
          deleted++;
        } catch (e) {
          errors.push({ path: item.path, error: e.message });
        }
      }

      return res.status(200).json({ success: true, deleted, errors });
    }

    // ───────────────────────────────────────────────────
    // SCAN: find every image file in base-images/, current-images/,
    // diff-images/ that isn't referenced by any reports.json
    // ───────────────────────────────────────────────────
    const { data: repoInfo } = await octokit.repos.get({ owner: OWNER, repo: REPO });
    const defaultBranch = repoInfo.default_branch;

    const { data: refData } = await octokit.git.getRef({ owner: OWNER, repo: REPO, ref: `heads/${defaultBranch}` });
    const { data: commitData } = await octokit.git.getCommit({ owner: OWNER, repo: REPO, commit_sha: refData.object.sha });
    const { data: treeData } = await octokit.git.getTree({
      owner: OWNER, repo: REPO, tree_sha: commitData.tree.sha, recursive: true,
    });

    const imageFiles = treeData.tree.filter(item =>
      item.type === 'blob' &&
      (item.path.startsWith('base-images/') || item.path.startsWith('current-images/') || item.path.startsWith('diff-images/'))
    );

    // Load projects.json
    let projects = [];
    try {
      const { data: projData } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: 'reports/projects.json' });
      const decoded = Buffer.from(projData.content.replace(/\s/g, ""), "base64").toString("utf8");
      projects = JSON.parse(decoded);
    } catch (e) {
      projects = [];
    }

    // Collect every path that's still in active use
    const referenced = new Set();
    for (const proj of projects) {
      for (const testName of (proj.testNames || [])) {
        referenced.add(`base-images/${proj.name}/${testName}.png`);
        referenced.add(`current-images/${proj.name}/${testName}.png`);

        try {
          const { data: repData } = await octokit.repos.getContent({
            owner: OWNER, repo: REPO, path: `reports/${proj.name}/${testName}/reports.json`,
          });
          const decoded = Buffer.from(repData.content.replace(/\s/g, ""), "base64").toString("utf8");
          const reports = JSON.parse(decoded);
          reports.forEach(r => { if (r.diffImagePath) referenced.add(r.diffImagePath); });
        } catch (e) { /* no reports yet for this test */ }
      }
    }

    // Anything on disk but not referenced = orphan
    const orphans = imageFiles
      .filter(f => !referenced.has(f.path))
      .map(f => ({ path: f.path, size: f.size || 0, sha: f.sha }));

    const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

    return res.status(200).json({
      success: true,
      totalFiles: imageFiles.length,
      totalReferenced: referenced.size,
      orphanCount: orphans.length,
      orphanSizeBytes: totalSize,
      orphans,
    });

  } catch (err) {
    console.error("Cleanup error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
