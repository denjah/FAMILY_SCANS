import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { ArchiveManifest, Asset, AssetKind, AssetVersion, EmbeddedNote } from "../src/types/archive";

const ARCHIVE_ROOT = path.resolve(process.env.ARCHIVE_ROOT || "Z:/SCAN");
const DATA_ROOT = path.resolve(process.env.ARCHIVE_DATA_ROOT || "Z:/SCAN/SYSTEM_WEB/data");
const INCLUDE_ROOTS = ["ALENA", "DAN", "DEN", "PAPA", "SCANS_2025", "БАБУШКА"];
const BRANCH_LABELS: Record<string, string> = { ALENA: "МАМА" };
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff", ".heic", ".heif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf"]);
const SENSITIVE_PATTERN = /(паспорт|pase|passport|удостовер|военн|трудов|birth|рожд|аттестат|atestat|диплом|билет|certificate|свидетельств)/iu;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
};
const execFileAsync = promisify(execFile);

function configuredPoppler(name: "pdfinfo" | "pdftoppm"): string {
  const localEnv = fsSync.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  const configured = process.env.ARCHIVE_POPPLER_BIN || localEnv.match(/^ARCHIVE_POPPLER_BIN=(.+)$/mu)?.[1]?.trim();
  return configured ? path.join(configured, `${name}${process.platform === "win32" ? ".exe" : ""}`) : name;
}

type ExifAuditEntry = { path: string; text_fields?: Record<string, string> };
type BatchDescription = { title: string; caption: string };

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" })[entity] || entity).replaceAll(/\s+/g, " ").trim();
}

function xmpValue(xmp: string, field: "title" | "description"): string | null {
  const match = xmp.match(new RegExp(`<dc:${field}[^>]*>[\\s\\S]*?<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>[\\s\\S]*?</dc:${field}>`, "iu"));
  const value = match ? decodeXml(match[1]) : "";
  return /[а-яё]{3}/iu.test(value) ? value : null;
}

function embeddedNotesByPath(): Map<string, EmbeddedNote[]> {
  const result = new Map<string, EmbeddedNote[]>();
  const file = path.join(ARCHIVE_ROOT, "_exif_extract.json");
  try {
    const audit = JSON.parse(fsSync.readFileSync(file, "utf8")) as { files_with_text?: ExifAuditEntry[] };
    for (const entry of audit.files_with_text || []) {
      const fields = entry.text_fields || {};
      const notes: EmbeddedNote[] = [];
      const description = fields.ImageDescription?.trim();
      if (description && description.length >= 40 && /[а-яё]{3}/iu.test(description) && !/Upscaled with Gigapixel|Face recovery version/iu.test(description)) {
        notes.push({ body: description, source: "EXIF" });
      }
      for (const key of ["XPTitle", "XPComment", "XPSubject"] as const) {
        const value = fields[key]?.trim();
        if (value && /[а-яё]{3}/iu.test(value) && !notes.some((note) => note.body === value)) notes.push({ title: key, body: value, source: "EXIF" });
      }
      const xmp = fields.XMP;
      if (xmp) {
        const title = xmpValue(xmp, "title");
        const body = xmpValue(xmp, "description");
        if (body && !notes.some((note) => note.body === body)) notes.push({ title: title || undefined, body, source: "XMP" });
      }
      if (notes.length) result.set(entry.path.replaceAll("\\", "/"), notes);
    }
  } catch {
    // EXIF audit is optional; an archive without it remains indexable.
  }
  return result;
}

/** Read the curator-written descriptions from the ALENA batch files.
 * The files are data exports: only their front matter and Markdown text are used.
 */
function batchDescriptionsByPath(): Map<string, BatchDescription> {
  const result = new Map<string, BatchDescription>();
  const batchesDirectory = path.join(ARCHIVE_ROOT, "_BATCHES");
  try {
    const files = fsSync.readdirSync(batchesDirectory)
      .filter((file) => /^ALENA_batch_\d+\.md$/iu.test(file))
      .sort((a, b) => a.localeCompare(b, "en"));
    for (const file of files) {
      const source = fsSync.readFileSync(path.join(batchesDirectory, file), "utf8");
      const entries = source.matchAll(/^---\r?\n(?=id:)([\s\S]*?)\r?\n---\r?\n([\s\S]*?)(?=^---\r?\n(?=id:)|^=== Batch|(?![\s\S]))/gmu);
      for (const entry of entries) {
        const frontMatter = entry[1];
        const body = entry[2];
        const masterFile = frontMatter.match(/^master_file:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim();
        if (!masterFile) continue;
        const title = frontMatter.match(/^title:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim() || "";
        const imageAlt = body.match(/!\[([^\]]*)\](?:\([^)]*\))?/u)?.[1]?.trim() || "";
        const prose = body
          .replace(/^#\s+.*$/mu, "")
          .replace(/!\[[^\]]*\](?:\([^)]*\))?/gu, "")
          .replace(/^---\s*$/gmu, "")
          .replace(/^={3,}.*$/gmu, "")
          .replaceAll(/\s+/g, " ")
          .trim();
        result.set(masterFile.replaceAll("\\", "/"), { title, caption: prose || imageAlt });
      }
    }
  } catch {
    // Batch descriptions are optional; the regular file index stays available without them.
  }
  return result;
}

function stableId(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").normalize("NFC").toLocaleLowerCase("en-US");
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

function titleFromName(fileName: string): string {
  return path.basename(fileName, path.extname(fileName)).replaceAll(/[-_]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function versionHint(fileName: string): string | null {
  const match = fileName.match(/(?:^|[-_])(2x|4x|c\d*|col\d*|topaz|faceai|rest(?:ored)?|recovered|hires|lowres|up\d*|u\d*|prw)(?:[-_.]|$)/iu);
  return match?.[1]?.toUpperCase() || null;
}

function versionGroupKey(fileName: string): string {
  const stem = path.basename(fileName, path.extname(fileName)).normalize("NFC");
  // Editing tools append chains such as "-topaz-denoise-enhance-4x-faceai".
  // Remove the full chain from its first explicit processing marker, but keep
  // numbered scan names intact when they have no such marker.
  const processingMarker = /(?:^|[\s_.-])(?:\d+(?:\.\d+)?x[cv]?|topaz|denoise|enhance|faceai|sharpen|remove|exposure|c\d*|col\d*|rest(?:ored)?|recovered|hires|lowres|up\d*|u\d*|prw|video|v)(?=$|[\s_.!-])/giu;
  const marker = processingMarker.exec(stem);
  const base = marker ? stem.slice(0, marker.index) : stem;
  return base.replace(/[\s_.-]+$/u, "").toLocaleLowerCase("ru");
}

function asVersion(asset: Asset): AssetVersion {
  return {
    id: asset.id,
    relativePath: asset.relativePath,
    fileName: asset.fileName,
    technicalMetadata: asset.technicalMetadata,
    webPreview: asset.webPreview,
    versionHint: asset.versionHint,
    embeddedNotes: asset.embeddedNotes,
  };
}

function versionScore(asset: Asset): number {
  const name = asset.fileName;
  const pixels = (asset.technicalMetadata.width || 0) * (asset.technicalMetadata.height || 0);
  const colorBonus = /(?:^|[-_])(c\d*|col\d*)(?:[-_.]|$)/iu.test(name) ? 1e15 : 0;
  const explicitVersion = asset.versionHint ? 1e12 : 0;
  return colorBonus + explicitVersion + pixels * 100 + asset.technicalMetadata.bytes + Date.parse(asset.technicalMetadata.modifiedAt) / 1e6;
}

function groupVersions(assets: Asset[]): Asset[] {
  const groups = new Map<string, Asset[]>();
  for (const asset of assets) {
    // The same generic scan names can occur in different family subalbums.
    const directory = path.dirname(asset.relativePath).normalize("NFC").toLocaleLowerCase("ru");
    const key = `${directory}\u0000${versionGroupKey(asset.fileName)}`;
    const group = groups.get(key);
    if (group) group.push(asset); else groups.set(key, [asset]);
  }
  return [...groups.values()].map((group) => {
    group.sort((a, b) => versionScore(b) - versionScore(a) || a.fileName.localeCompare(b.fileName, "ru"));
    const selected = group[0];
    return { ...selected, versions: group.map(asVersion) };
  });
}

function sideFromName(fileName: string): Asset["side"] {
  if (/(?:^|[-_])(back|оборот)(?:[-_.]|$)/iu.test(fileName)) return "back";
  if (/(?:^|[-_])(front|лицо)(?:[-_.]|$)/iu.test(fileName)) return "front";
  return "unknown";
}

async function collectFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".BridgeSort") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && (PHOTO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || DOCUMENT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))) output.push(absolute);
    }
  }
  await walk(root);
  return output;
}

async function indexOne(absolutePath: string, notesByPath: Map<string, EmbeddedNote[]>, batchDescriptions: Map<string, BatchDescription>): Promise<{ asset: Asset; error?: { relativePath: string; message: string } }> {
  const relativePath = path.relative(ARCHIVE_ROOT, absolutePath);
  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).toLowerCase();
  const stat = await fs.stat(absolutePath);
  let width: number | null = null;
  let height: number | null = null;
  let pages: number | null = null;
  let webPreview = true;
  let error: { relativePath: string; message: string } | undefined;
  try {
    if (extension === ".pdf") {
      const { stdout } = await execFileAsync(configuredPoppler("pdfinfo"), [absolutePath]);
      const pageMatch = stdout.match(/^Pages:\s+(\d+)/mu);
      const sizeMatch = stdout.match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)/mu);
      pages = pageMatch ? Number(pageMatch[1]) : null;
      width = sizeMatch ? Math.round(Number(sizeMatch[1])) : null;
      height = sizeMatch ? Math.round(Number(sizeMatch[2])) : null;
      webPreview = Boolean(pages);
    } else {
      const metadata = await sharp(absolutePath, { failOn: "none", limitInputPixels: false }).metadata();
      width = metadata.width || null;
      height = metadata.height || null;
      pages = metadata.pages || null;
      webPreview = Boolean(width && height);
    }
  } catch (cause) {
    webPreview = false;
    error = { relativePath, message: cause instanceof Error ? cause.message : String(cause) };
  }
  const sensitive = SENSITIVE_PATTERN.test(relativePath);
  const kind: AssetKind = sensitive || DOCUMENT_EXTENSIONS.has(extension) ? "document" : "photo";
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const batchDescription = batchDescriptions.get(normalizedPath);
  const asset: Asset = {
    id: stableId(relativePath),
    relativePath: normalizedPath,
    fileName,
    kind,
    title: batchDescription?.title || titleFromName(fileName),
    caption: batchDescription?.caption || "",
    branch: BRANCH_LABELS[relativePath.split(path.sep)[0]] || relativePath.split(path.sep)[0] || "Архив",
    technicalMetadata: {
      extension: extension.slice(1).toUpperCase(),
      mimeType: MIME[extension] || "application/octet-stream",
      bytes: stat.size,
      width,
      height,
      pages,
      modifiedAt: stat.mtime.toISOString(),
    },
    takenAt: null,
    takenAtPrecision: "unknown",
    sensitive,
    webPreview,
    versionHint: versionHint(fileName),
    side: sideFromName(fileName),
    embeddedNotes: notesByPath.get(normalizedPath),
  };
  return { asset, error };
}

async function main(): Promise<void> {
  const allFiles = (await Promise.all(INCLUDE_ROOTS.map((name) => collectFiles(path.join(ARCHIVE_ROOT, name))))).flat();
  const notesByPath = embeddedNotesByPath();
  const batchDescriptions = batchDescriptionsByPath();
  allFiles.sort((a, b) => a.localeCompare(b, "ru"));
  const assets: Asset[] = new Array(allFiles.length);
  const errors: ArchiveManifest["errors"] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, allFiles.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= allFiles.length) break;
      const result = await indexOne(allFiles[index], notesByPath, batchDescriptions);
      assets[index] = result.asset;
      if (result.error) errors.push(result.error);
      if ((index + 1) % 200 === 0) console.log(`Indexed ${index + 1}/${allFiles.length}`);
    }
  });
  await Promise.all(workers);
  const visibleAssets = groupVersions(assets);
  const manifest: ArchiveManifest = {
    generatedAt: new Date().toISOString(),
    archiveRoot: ARCHIVE_ROOT,
    assetCount: visibleAssets.length,
    errorCount: errors.length,
    assets: visibleAssets,
    errors,
  };
  await fs.mkdir(DATA_ROOT, { recursive: true });
  const target = path.join(DATA_ROOT, "archive-index.json");
  await fs.writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(DATA_ROOT, "index-errors.json"), `${JSON.stringify(errors, null, 2)}\n`, "utf8");
  console.log(`Index complete: ${visibleAssets.length} archive cards from ${assets.length} files, ${errors.length} metadata errors.`);
  console.log(`Loaded ${batchDescriptions.size} ALENA descriptions from batch files.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
