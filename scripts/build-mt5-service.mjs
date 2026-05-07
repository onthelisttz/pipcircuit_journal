import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const serviceDir = path.join(repoRoot, "local-services", "mt5-history-service");
const entryPath = path.join(serviceDir, "history-reader.mjs");
const bridgeName = process.platform === "win32" ? "request_mt5_bars.exe" : "request_mt5_bars";
const bridgeSourcePath = path.join(serviceDir, "bin", bridgeName);
const distDir = path.join(serviceDir, "dist");
const distBinDir = path.join(distDir, "bin");
const distNodeModulesDir = path.join(distDir, "node_modules");
const serviceOutputPath = path.join(
  distDir,
  process.platform === "win32" ? "mt5-history-service.exe" : "mt5-history-service"
);
const require = createRequire(import.meta.url);
const runtimeRootPackages = ["@reiryoku/ctrader-layer"];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function copyRecursive(sourcePath, destinationPath) {
  const stats = await fs.stat(sourcePath);
  if (stats.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      await copyRecursive(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name)
      );
    }
    return;
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function collectRuntimePackageDirs(packageName, collected = new Map()) {
  if (collected.has(packageName)) {
    return collected;
  }

  const packageJsonPath = require.resolve(`${packageName}/package.json`, {
    paths: [repoRoot],
  });
  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  collected.set(packageName, packageDir);

  const dependencies = Object.keys(packageJson.dependencies ?? {});
  for (const dependencyName of dependencies) {
    await collectRuntimePackageDirs(dependencyName, collected);
  }

  return collected;
}

async function main() {
  await fs.access(entryPath);
  await fs.access(bridgeSourcePath);

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distBinDir, { recursive: true });
  await fs.mkdir(distNodeModulesDir, { recursive: true });

  await run("bun", ["build", "--compile", entryPath, "--outfile", serviceOutputPath]);
  await fs.copyFile(bridgeSourcePath, path.join(distBinDir, bridgeName));

  const runtimePackageDirs = new Map();
  for (const packageName of runtimeRootPackages) {
    await collectRuntimePackageDirs(packageName, runtimePackageDirs);
  }

  for (const [packageName, packageDir] of runtimePackageDirs) {
    await copyRecursive(
      packageDir,
      path.join(distNodeModulesDir, ...packageName.split("/"))
    );
  }


}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
