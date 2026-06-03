import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(rootDir, ".release");

function git(args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

const commit = git(["rev-parse", "--short", "HEAD"]);
const branch = git(["branch", "--show-current"]);
const dirty = git(["status", "--short"]);
const createdAt = new Date().toISOString();
const version = "0.2.0";
const name = `agent-communication-v${version}-${commit}`;
const archivePath = path.join(releaseDir, `${name}.tgz`);
const manifestPath = path.join(releaseDir, `${name}.manifest.json`);

await mkdir(releaseDir, { recursive: true });

execFileSync("tar", [
  "--exclude=.git",
  "--exclude=node_modules",
  "--exclude=.release",
  "--exclude=server/data",
  "--exclude=dist",
  "--exclude=.env",
  "--exclude=.env.local",
  "--exclude=.env.development",
  "--exclude=.env.production",
  "--exclude=.DS_Store",
  "-czf",
  archivePath,
  "."
], { cwd: rootDir, stdio: "inherit" });

await writeFile(manifestPath, JSON.stringify({
  name,
  version,
  branch,
  commit,
  dirty: Boolean(dirty),
  createdAt,
  archive: archivePath
}, null, 2), "utf8");

console.log(JSON.stringify({
  ok: true,
  archive: archivePath,
  manifest: manifestPath,
  branch,
  commit,
  dirty: Boolean(dirty)
}, null, 2));
