const { Octokit } = require("@octokit/rest");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const { reportIds, projectName, testName } = req.body;
  if (!reportIds || !reportIds.length || !projectName || !testName) {
    return res.status(400).json({ error: "Missing reportIds, projectName or testName" });
  }

  try {
    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    const reportsPath = `reports/${projectName}/${testName}/reports.json`;

    // Load reports
    let reports = [];
    let reportsSha;
    try {
      const existingReports = await octokit.repos.getContent({
        owner: OWNER, repo: REPO, path: reportsPath,
      });
      reportsSha = existingReports.data.sha;
      const decoded = Buffer.from(existingReports.data.content.replace(/\s/g, ""), "base64").toString("utf8");
      reports = JSON.parse(decoded);
    } catch (e) {
      return res.status(404).json({ error: "No reports found" });
    }

    // Delete diff images
    for (const reportId of reportIds) {
      const report = reports.find(r => r.id === reportId);
      if (report && report.diffImagePath) {
        try {
          const diffFile = await octokit.repos.getContent({
            owner: OWNER, repo: REPO, path: report.diffImagePath,
          });
          await octokit.repos.deleteFile({
            owner: OWNER, repo: REPO,
            path: report.diffImagePath,
            message: `Delete diff: ${reportId}`,
            sha: diffFile.data.sha,
          });
        } catch (e) {}
      }
    }

    // Filter deleted
    const updatedReports = reports.filter(r => !reportIds.includes(r.id));

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO,
      path: reportsPath,
      message: `Delete reports: ${reportIds.length} from ${projectName}/${testName}`,
      content: Buffer.from(JSON.stringify(updatedReports, null, 2)).toString("base64"),
      sha: reportsSha,
    });

    return res.status(200).json({
      success: true,
      deleted: reportIds.length,
      remaining: updatedReports.length
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
