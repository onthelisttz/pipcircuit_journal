import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const serviceDir = path.join(rootDir, "local-services", "mt5-history-service");
const scriptPath = path.join(serviceDir, "request_mt5_bars.py");
const binDir = path.join(serviceDir, "bin");
const buildDir = path.join(serviceDir, ".pyinstaller-build");
const specDir = path.join(serviceDir, ".pyinstaller-spec");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      windowsHide: true,
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
  await mkdir(binDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await mkdir(specDir, { recursive: true });

  const args = [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--collect-all",
    "MetaTrader5",
    "--collect-all",
    "numpy",
    "--name",
    "request_mt5_bars",
    "--distpath",
    binDir,
    "--workpath",
    buildDir,
    "--specpath",
    specDir,
    scriptPath,
  ];

  try {
    await run("python", args);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown PyInstaller build error.";
    throw new Error(
      `${message}\nInstall the build dependency first with: python -m pip install pyinstaller MetaTrader5`
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
