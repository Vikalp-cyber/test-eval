/**
 * Load `.env` before any `@test-evals/env/server` import so DATABASE_URL and auth
 * vars resolve when running via Turborepo (cwd may differ) or from repo root.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appServerRoot = path.join(here, "..");
const repoRoot = path.resolve(appServerRoot, "../..");

config({ path: path.join(repoRoot, ".env") });
config({ path: path.join(appServerRoot, ".env"), override: true });
