import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
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
const serviceOutputPath = path.join(
  distDir,
  process.platform === "win32" ? "mt5-history-service.exe" : "mt5-history-service"
);

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

async function main() {
  await fs.access(entryPath);
  await fs.access(bridgeSourcePath);

  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distBinDir, { recursive: true });

  await run("bun", ["build", "--compile", entryPath, "--outfile", serviceOutputPath]);
  await fs.copyFile(bridgeSourcePath, path.join(distBinDir, bridgeName));

  console.log(`Built MT5 service executable: ${serviceOutputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
