import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(scriptDir);
const serviceDir = path.join(repoRoot, "local-services", "mt5-history-service");
const distDir = path.join(serviceDir, "dist");
const bundleAssetsDir = path.join(serviceDir, "bundle-assets");
const releaseDir = path.join(serviceDir, "release");
const bundleRoot = path.join(releaseDir, "mt5-history-service-windows-x64");
const zipPath = path.join(releaseDir, "mt5-history-service-windows-x64.zip");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
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

async function main() {
  await fs.access(path.join(distDir, "mt5-history-service.exe"));
  await fs.access(path.join(distDir, "bin", "request_mt5_bars.exe"));
  await fs.access(bundleAssetsDir);

  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.mkdir(bundleRoot, { recursive: true });

  await copyRecursive(path.join(distDir, "mt5-history-service.exe"), path.join(bundleRoot, "mt5-history-service.exe"));
  await copyRecursive(path.join(distDir, "bin"), path.join(bundleRoot, "bin"));
  await copyRecursive(path.join(serviceDir, "start-mt5-service.cmd"), path.join(bundleRoot, "start-mt5-service.cmd"));

  const assetEntries = await fs.readdir(bundleAssetsDir, { withFileTypes: true });
  for (const entry of assetEntries) {
    await copyRecursive(
      path.join(bundleAssetsDir, entry.name),
      path.join(bundleRoot, entry.name)
    );
  }

  const compressScript = [
    `$zip='${zipPath.replace(/'/g, "''")}';`,
    `$source='${path.join(bundleRoot, "*").replace(/'/g, "''")}';`,
    "if (Test-Path $zip) { Remove-Item $zip -Force }",
    "Compress-Archive -Path $source -DestinationPath $zip -Force",
  ].join(" ");
  await run("powershell", ["-NoProfile", "-Command", compressScript]);

  console.log(`Created MT5 service bundle: ${bundleRoot}`);
  console.log(`Created MT5 service zip: ${zipPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
