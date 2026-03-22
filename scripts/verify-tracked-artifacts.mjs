import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: process.cwd(),
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);

const trackedArtifactPatterns = [
  /^\.next\//,
  /^coverage\//,
  /^out\//,
  /^build\//,
  /^test-results\//,
];

const offenders = trackedFiles.filter((file) =>
  trackedArtifactPatterns.some((pattern) => pattern.test(file)),
);

if (offenders.length > 0) {
  console.error("Tracked generated artifacts found:");
  for (const file of offenders) {
    console.error(` - ${file}`);
  }
  process.exit(1);
}

console.log("No tracked generated artifacts detected.");
