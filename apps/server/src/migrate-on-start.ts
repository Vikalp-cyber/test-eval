/**
 * Run database migrations on server startup with a Postgres advisory lock so
 * only one instance migrates at a time (safe for multi-instance Render
 * deployments).
 *
 * Behaviour:
 * - Skipped entirely when `AUTO_MIGRATE=false`.
 * - Skipped (no-op) if the DB is busy migrating in another instance.
 * - Best-effort by default; set `FAIL_ON_MIGRATE_ERROR=true` to crash the
 *   server when migration fails (useful in CI / staging).
 *
 * Implementation: acquires a session-scoped pg_advisory_lock, then spawns
 * `bun x drizzle-kit push --force` from `packages/db`. The bundled server
 * still has access to the `packages/db` source on Render because Render
 * preserves the full repo on disk after `bun install`.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

// Arbitrary stable big-int. Same key across instances → mutual exclusion.
const ADVISORY_LOCK_KEY = "7825611423";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `apps/server/src/migrate-on-start.ts` → repo root  → `packages/db`
 * `apps/server/dist/index.mjs`           → repo root  → `packages/db`
 * Both resolve to `../../../packages/db` from the file location.
 */
function findDbPackageDir(): string {
  return path.resolve(here, "../../../packages/db");
}

export async function runMigrationsOnStart(): Promise<void> {
  const enabled = (process.env.AUTO_MIGRATE ?? "true").toLowerCase();
  if (enabled !== "true" && enabled !== "1") {
    console.log("[migrate] AUTO_MIGRATE disabled; skipping startup migration.");
    return;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.warn("[migrate] DATABASE_URL not set; skipping startup migration.");
    return;
  }

  const client = new Client({ connectionString: dbUrl });
  let lockAcquired = false;

  try {
    await client.connect();

    const lockRes = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS ok",
      [ADVISORY_LOCK_KEY],
    );
    if (!lockRes.rows[0]?.ok) {
      console.log(
        "[migrate] Migration is in progress in another instance; skipping.",
      );
      return;
    }
    lockAcquired = true;

    console.log("[migrate] Acquired migration lock; running drizzle-kit push…");
    const dbDir = findDbPackageDir();
    await runCommand("bun", ["x", "drizzle-kit", "push", "--force"], dbDir);
    console.log("[migrate] Schema migrations applied successfully.");
  } catch (err) {
    console.error("[migrate] Startup migration failed:", err);
    if (process.env.FAIL_ON_MIGRATE_ERROR === "true") {
      throw err;
    }
  } finally {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [
          ADVISORY_LOCK_KEY,
        ]);
      } catch {
        // best effort
      }
    }
    try {
      await client.end();
    } catch {
      // best effort
    }
  }
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}
