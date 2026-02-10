#!/usr/bin/env node
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const PKGS = [
  // Build core first so dependent packages can resolve types.
  "lightweight-charts-line-tools-core",
  "lightweight-charts-line-tools-rectangle",
  "lightweight-charts-line-tools-lines",
  "lightweight-charts-line-tools-path",
  "lightweight-charts-line-tools-long-short-position",
];

const root = join(process.cwd(), "node_modules");
for (const pkg of PKGS) {
  const pkgPath = join(root, pkg);
  const distPath = join(pkgPath, "dist");
  if (existsSync(distPath)) {
    console.log(`[skip] ${pkg} already has dist`);
    continue;
  }
  console.log(`Building ${pkg}...`);
  try {
    // Use root-installed tooling and avoid local installs that shadow built deps.
    execSync("bunx rollup -c", {
      cwd: pkgPath,
      stdio: "inherit",
    });
  } catch (e) {
    console.error(`Failed to build ${pkg}:`, e.message);
    process.exit(1);
  }
}
console.log("Line tools build complete.");
