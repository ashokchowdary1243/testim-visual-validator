const { Octokit } = require("@octokit/rest");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");
const Jimp = require("jimp");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  let { image, testName, projectName, threshold = 0.1 } = req.body;
  if (!image || !testName || !projectName) {
    return res.status(400).json({ error: "Missing image, testName or projectName" });
  }

  try {
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const timestamp = new Date().toISOString();
    const reportId = `${testName}_${Date.now()}`;

    const OWNER = process.env.GITHUB_OWNER;
    const REPO = process.env.GITHUB_REPO;

    console.log(`[START] Project: ${projectName} | Test: ${testName}`);

    // 1. Fetch base image
    let baseFile;
    try {
      baseFile = await octokit.repos.getContent({
        owner: OWNER, repo: REPO,
        path: `base-images/${projectName}/${testName}.png`,
      });
    } catch (gitErr) {
      if (gitErr.status === 404) {
        return res.status(404).json({ error: `Base image not found for '${projectName}/${testName}'. Run IS_FIRST_RUN = true first.` });
      }
      throw gitErr;
    }

    // 2. Convert base64
    const baseCleaned = baseFile.data.content.replace(/\s/g, "");
    const incomingCleaned = image.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "");

    // 3. Convert to PNG using Jimp
    const baseBuffer = Buffer.from(baseCleaned, "base64");
    const basePng = PNG.sync.read(baseBuffer);
    const width = basePng.width;
    const height = basePng.height;

    const currentJimp = await Jimp.read(Buffer.from(incomingCleaned, "base64"));
    currentJimp.resize(width, height);
    const currentPngBuffer = await currentJimp.getBufferAsync(Jimp.MIME_PNG);
    const currentPng = PNG.sync.read(currentPngBuffer);
    const currentPngBase64 = currentPngBuffer.toString("base64");

    // 4. Save current image
    let currentSha;
    try {
      const existing = await octokit.repos.getContent({
        owner: OWNER, repo: REPO,
        path: `current-images/${projectName}/${testName}.png`,
      });
      currentSha = existing.data.sha;
    } catch (e) {}

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO,
      path: `current-images/${projectName}/${testName}.png`,
      message: `Update current: ${projectName}/${testName}`,
      content: currentPngBase64,
      ...(currentSha && { sha: currentSha }),
    });

    // 5. Pixel compare
    const diff = new PNG({ width, height });
    const mismatchedPixels = pixelmatch(
      basePng.data, currentPng.data, diff.data, width, height,
      { threshold: 0.1 }
    );

    const totalPixels = width * height;
    const diffPercentage = ((mismatchedPixels / totalPixels) * 100).toFixed(2);
    const pass = parseFloat(diffPercentage) <= threshold;

    // 6. Save diff image if FAIL
    let diffImagePath = null;
    if (!pass) {
      diffImagePath = `diff-images/${projectName}/${testName}/${reportId}.png`;
      let diffSha;
      try {
        const existingDiff = await octokit.repos.getContent({
          owner: OWNER, repo: REPO, path: diffImagePath,
        });
        diffSha = existingDiff.data.sha;
      } catch (e) {}

      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER, repo: REPO,
        path: diffImagePath,
        message: `Diff: ${projectName}/${testName}/${reportId}`,
        content: PNG.sync.write(diff).toString("base64"),
        ...(diffSha && { sha: diffSha }),
      });
    }

    // 7. Load existing reports for this test
    const reportsPath = `reports/${projectName}/${testName}/reports.json`;
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
      reports = [];
    }

    // 8. Add new report
    const report = {
      id: reportId,
      testName,
      projectName,
      timestamp,
      pass,
      diffPercentage: parseFloat(diffPercentage),
      mismatchedPixels,
      totalPixels,
      baseImagePath: `base-images/${projectName}/${testName}.png`,
      currentImagePath: `current-images/${projectName}/${testName}.png`,
      diffImagePath,
      message: pass
        ? `PASS - Images match! (${diffPercentage}% diff)`
        : `FAIL - ${diffPercentage}% difference detected!`
    };

    reports.unshift(report);

    await octokit.repos.createOrUpdateFileContents({
      owner: OWNER, repo: REPO,
      path: reportsPath,
      message: `Report: ${projectName}/${testName}/${reportId}`,
      content: Buffer.from(JSON.stringify(reports, null, 2)).toString("base64"),
      ...(reportsSha && { sha: reportsSha }),
    });

    // 9. Update projects.json
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
      pass,
      diffPercentage: parseFloat(diffPercentage),
      mismatchedPixels,
      totalPixels,
      reportId,
      message: report.message
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};