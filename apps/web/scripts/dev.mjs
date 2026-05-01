/**
 * Next dev with configurable port (default 3101) to avoid EADDRINUSE on 3001.
 * Usage: WEB_PORT=3001 node scripts/dev.mjs
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = (process.env.WEB_PORT || "3101").trim();
const isWin = process.platform === "win32";
const nextBinName = isWin ? "next.cmd" : "next";

function findNextBin(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "node_modules", ".bin", nextBinName);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const nextExecutable = findNextBin(root);
const useLocal = Boolean(nextExecutable);

const cmd = useLocal ? nextExecutable : "npx";
const args = useLocal ? ["dev", "--port", port] : ["next", "dev", "--port", port];

const child = spawn(cmd, args, {
  cwd: root,
  stdio: "inherit",
  shell: isWin || !useLocal,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
