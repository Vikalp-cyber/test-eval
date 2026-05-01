import { Hono } from "hono";
import fs from "fs/promises";
import path from "path";

const router = new Hono();

const ROOT_DIR = path.resolve(process.cwd(), "../../");
const DATASET_DIR = path.join(ROOT_DIR, "data/transcripts");

function safeTranscriptFilename(id: string): string | null {
  const base = path.basename(id);
  if (base !== id || base.includes("..") || !base.endsWith(".txt")) {
    return null;
  }
  return base;
}

/** GET /api/v1/transcripts/:transcriptId — raw transcript text for dashboard */
router.get("/:transcriptId", async (c) => {
  const raw = c.req.param("transcriptId");
  const filename = safeTranscriptFilename(raw);
  if (!filename) {
    return c.json({ error: "Invalid transcript id" }, 400);
  }
  const filePath = path.join(DATASET_DIR, filename);
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return c.json({ transcriptId: filename, text });
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

export { router as transcriptsRouter };
