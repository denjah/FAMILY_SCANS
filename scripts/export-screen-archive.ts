import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import type { ArchiveManifest, Asset, AssetVersion } from "../src/types/archive";

const projectRoot = process.cwd();
const archiveRoot = path.resolve(process.env.ARCHIVE_ROOT || "Z:/SCAN");
const dataRoot = path.resolve(process.env.ARCHIVE_DATA_ROOT || path.join(projectRoot, "data"));
const outputRoot = path.resolve(process.env.ARCHIVE_SCREEN_EXPORT_ROOT || "Z:/SCAN/WEB_SCREEN_ARCHIVE");
const maxEdge = 1600;
const parallelism = Math.min(4, Math.max(1, os.cpus().length - 1));
const execFileAsync = promisify(execFile);

type ExportedVersion = AssetVersion & { screen: string; screenPages?: string[] };
type ExportedAsset = Omit<Asset, "versions"> & { screen: string; screenPages?: string[]; versions: ExportedVersion[] };

function poppler(name: "pdftoppm"): string {
  const envFile = path.join(projectRoot, ".env.local");
  const localEnv = fsSync.existsSync(envFile) ? fsSync.readFileSync(envFile, "utf8") : "";
  const configured = process.env.ARCHIVE_POPPLER_BIN || localEnv.match(/^ARCHIVE_POPPLER_BIN=(.+)$/mu)?.[1]?.trim();
  return configured ? path.join(configured, `${name}${process.platform === "win32" ? ".exe" : ""}`) : name;
}

function outputFor(id: string): string {
  return path.join(outputRoot, "media", `${id}.webp`);
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true).catch(() => false);
}

async function renderImage(source: string, destination: string): Promise<void> {
  if (await exists(destination)) return;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await sharp(source, { failOn: "none", limitInputPixels: false })
    .rotate()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 4 })
    .toFile(destination);
}

async function renderPdf(source: string, id: string, pages: number): Promise<string[]> {
  const folder = path.join(outputRoot, "media", id);
  await fs.mkdir(folder, { recursive: true });
  const results: string[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const destination = path.join(folder, `page-${String(page).padStart(3, "0")}.webp`);
    if (!await exists(destination)) {
      const temporaryPrefix = path.join(folder, `.render-${page}-${Date.now()}`);
      const temporaryPng = `${temporaryPrefix}.png`;
      try {
        await execFileAsync(poppler("pdftoppm"), ["-f", String(page), "-l", String(page), "-scale-to", String(maxEdge), "-png", "-singlefile", source, temporaryPrefix]);
        await sharp(temporaryPng, { failOn: "none", limitInputPixels: false }).webp({ quality: 80, effort: 4 }).toFile(destination);
      } finally {
        await fs.rm(temporaryPng, { force: true });
      }
    }
    results.push(path.posix.join("media", id, path.basename(destination)));
  }
  return results;
}

function variants(asset: Asset): AssetVersion[] {
  return asset.versions?.length ? asset.versions : [{
    id: asset.id,
    relativePath: asset.relativePath,
    fileName: asset.fileName,
    technicalMetadata: asset.technicalMetadata,
    webPreview: asset.webPreview,
    versionHint: asset.versionHint,
    embeddedNotes: asset.embeddedNotes,
  }];
}

async function main(): Promise<void> {
  if (await exists(outputRoot)) {
    if (process.env.ARCHIVE_SCREEN_EXPORT_REPLACE === "1") {
      const expectedOutput = path.resolve(archiveRoot, "WEB_SCREEN_ARCHIVE");
      if (outputRoot !== expectedOutput) throw new Error(`For safety, replacement is allowed only for ${expectedOutput}`);
      await fs.rm(outputRoot, { recursive: true, force: true });
    } else if (process.env.ARCHIVE_SCREEN_EXPORT_RESUME !== "1") {
      throw new Error(`Export folder already exists: ${outputRoot}`);
    }
  }
  const manifest = JSON.parse(await fs.readFile(path.join(dataRoot, "archive-index.json"), "utf8")) as ArchiveManifest;
  await fs.mkdir(path.join(outputRoot, "media"), { recursive: true });

  const unique = new Map<string, AssetVersion>();
  for (const asset of manifest.assets) for (const version of variants(asset)) unique.set(version.id, version);
  const failures: Array<{ id: string; relativePath: string; message: string }> = [];
  let completed = 0;
  const rendered = new Map<string, { screen: string; screenPages?: string[] }>();
  const queue = [...unique.entries()];

  async function worker(): Promise<void> {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      const [id, version] = item;
      try {
        const source = path.resolve(archiveRoot, version.relativePath);
        const isPdf = version.technicalMetadata.mimeType === "application/pdf";
        const screenPages = isPdf
          ? await renderPdf(source, id, version.technicalMetadata.pages || 1)
          : undefined;
        const screen = isPdf ? screenPages?.[0] || "" : path.posix.join("media", `${id}.webp`);
        if (!isPdf) await renderImage(source, outputFor(id));
        rendered.set(id, { screen, screenPages });
      } catch (error) {
        failures.push({ id, relativePath: version.relativePath, message: error instanceof Error ? error.message : String(error) });
      } finally {
        completed += 1;
        if (completed % 50 === 0 || completed === unique.size) process.stdout.write(`Rendered ${completed}/${unique.size}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: parallelism }, () => worker()));

  const assets: ExportedAsset[] = manifest.assets.map((asset) => {
    const versionList = variants(asset).map((version) => ({ ...version, ...(rendered.get(version.id) || { screen: "" }) }));
    const primary = rendered.get(asset.id) || rendered.get(versionList[0].id) || { screen: "" };
    return { ...asset, screen: primary.screen, screenPages: primary.screenPages, versions: versionList };
  });
  const exportedManifest = {
    ...manifest,
    archiveRoot: "Google Drive screen archive",
    generatedAt: new Date().toISOString(),
    screenExport: { maxEdge, rendered: rendered.size, failures: failures.length },
    assets,
  };
  await fs.writeFile(path.join(outputRoot, "archive-index.json"), JSON.stringify(exportedManifest, null, 2), "utf8");
  await fs.writeFile(path.join(outputRoot, "export-errors.json"), JSON.stringify(failures, null, 2), "utf8");
  await fs.writeFile(path.join(outputRoot, "README.txt"), [
    "Экранная копия семейного архива.",
    "Загрузите всю папку в Google Drive, сохранив структуру файлов.",
    "Оригиналы сюда не входят: изображения ограничены 1600 пикселями по большей стороне.",
    "archive-index.json связывает карточки и варианты с файлами в папке media.",
    "Не открывайте общий доступ по ссылке: папка будет подключаться к сайту через отдельный служебный доступ.",
  ].join("\r\n"), "utf8");
  process.stdout.write(`Export complete: ${rendered.size} rendered, ${failures.length} failed.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
