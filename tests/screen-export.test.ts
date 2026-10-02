import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");

async function digest(file: string): Promise<string> {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

test("screen export reuses unchanged photos and rebuilds changed photos", async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "archive-screen-export-"));
  const archiveRoot = path.join(temporaryRoot, "archive");
  const dataRoot = path.join(temporaryRoot, "data");
  const outputRoot = path.join(temporaryRoot, "screen");
  try {
    await fs.mkdir(path.join(archiveRoot, "FAMILY"), { recursive: true });
    await fs.mkdir(dataRoot);
    const first = path.join(archiveRoot, "FAMILY", "first.jpg");
    const second = path.join(archiveRoot, "FAMILY", "second.jpg");
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#bb9988" } }).jpeg().toFile(first);
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#8899bb" } }).jpeg().toFile(second);
    const assets = await Promise.all([first, second].map(async (file, index) => {
      const stat = await fs.stat(file);
      return {
        id: `photo-${index + 1}`,
        relativePath: `FAMILY/${path.basename(file)}`,
        fileName: path.basename(file),
        technicalMetadata: { mimeType: "image/jpeg", pages: null, bytes: stat.size, modifiedAt: stat.mtime.toISOString() },
      };
    }));
    await fs.writeFile(path.join(dataRoot, "archive-index.json"), JSON.stringify({ assets }));

    const runExport = async () => (await execFileAsync(process.execPath, [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"), path.join(projectRoot, "scripts", "export-screen-archive.ts")], {
      cwd: projectRoot,
      env: { ...process.env, ARCHIVE_ROOT: archiveRoot, ARCHIVE_DATA_ROOT: dataRoot, ARCHIVE_SCREEN_EXPORT_ROOT: outputRoot },
    })).stdout;

    assert.match(await runExport(), /2 rendered, 0 unchanged/);
    const firstOutput = path.join(outputRoot, "media", "photo-1.webp");
    const secondOutput = path.join(outputRoot, "media", "photo-2.webp");
    const beforeFirst = await digest(firstOutput);
    const beforeSecond = await digest(secondOutput);

    assert.match(await runExport(), /0 rendered, 2 unchanged/);
    assert.equal(await digest(firstOutput), beforeFirst);
    assert.equal(await digest(secondOutput), beforeSecond);

    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#334455" } }).jpeg().toFile(`${first}.new`);
    await fs.rename(`${first}.new`, first);
    assert.match(await runExport(), /1 rendered, 1 unchanged/);
    assert.notEqual(await digest(firstOutput), beforeFirst);
    assert.equal(await digest(secondOutput), beforeSecond);

    await fs.rm(path.join(outputRoot, ".export-state.json"));
    assert.match(await runExport(), /0 rendered, 2 unchanged/);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
