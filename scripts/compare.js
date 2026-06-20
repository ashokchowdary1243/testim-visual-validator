const fs = require("fs");
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");

const base = PNG.sync.read(fs.readFileSync("base-images/base.png"));
const current = PNG.sync.read(fs.readFileSync("current-images/base.png"));

const { width, height } = base;

const diff = new PNG({ width, height });

const mismatches = pixelmatch(
  base.data,
  current.data,
  diff.data,
  width,
  height,
  { threshold: 0.1 }
);

const percent = (mismatches / (width * height)) * 100;

fs.writeFileSync(
  "results/result.json",
  JSON.stringify({
    pass: percent < 5,
    diffPercentage: percent.toFixed(2),
  }, null, 2)
);

console.log("DONE:", percent);