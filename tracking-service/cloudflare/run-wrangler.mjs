import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const workerDirectory = path.resolve(import.meta.dirname);
const repositoryPackage = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
);
const wranglerVersion = repositoryPackage.devDependencies.wrangler;
const wranglerEntryCandidates = [
  path.join(repositoryRoot, "node_modules", "wrangler", "bin", "wrangler.js"),
  path.join(repositoryRoot, "node_modules", ".pnpm", `wrangler@${wranglerVersion}`, "node_modules", "wrangler", "bin", "wrangler.js"),
  path.join(repositoryRoot, ".pnpm", `wrangler@${wranglerVersion}`, "node_modules", "wrangler", "bin", "wrangler.js")
];
const wranglerEntry = wranglerEntryCandidates.find((candidate) => existsSync(candidate));
const xdgConfigHome = path.join(repositoryRoot, ".wrangler-config");

if (!wranglerEntry) {
  throw new Error("Wrangler is not installed. Run pnpm install from the repository folder.");
}

const result = spawnSync(
  process.execPath,
  [wranglerEntry, "deploy", ...process.argv.slice(2), "--config", "./wrangler.jsonc"],
  {
    cwd: workerDirectory,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: xdgConfigHome
    },
    stdio: "inherit"
  }
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
