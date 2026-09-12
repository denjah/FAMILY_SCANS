import fs from "node:fs";
import type { ArchiveManifest, Asset } from "@/types/archive";
import { manifestPath } from "@/lib/paths";
import { downloadHostedManifest, hostedArchiveEnabled } from "@/lib/drive";

let cachedManifest: ArchiveManifest | null = null;
let cachedMtime = 0;

export function getManifest(): ArchiveManifest {
  const file = manifestPath();
  const stat = fs.statSync(file);
  if (!cachedManifest || cachedMtime !== stat.mtimeMs) {
    cachedManifest = JSON.parse(fs.readFileSync(file, "utf8")) as ArchiveManifest;
    cachedMtime = stat.mtimeMs;
  }
  return cachedManifest;
}

export function findAsset(assetId: string): Asset | null {
  const asset = getManifest().assets.find((item) => item.id === assetId);
  if (asset) return asset;
  for (const item of getManifest().assets) {
    const version = item.versions?.find((candidate) => candidate.id === assetId);
    if (version) return { ...item, ...version };
  }
  return null;
}

export function publicAsset(asset: Asset): Asset {
  return {
    ...asset,
    relativePath: asset.relativePath.replaceAll("\\", "/"),
  };
}

let hostedManifestCache: { manifest: ArchiveManifest; expiresAt: number } | null = null;

export async function getRuntimeManifest(): Promise<ArchiveManifest> {
  // A local development server should always reflect a freshly built index,
  // even when production is configured to read the published Drive copy.
  if (process.env.NODE_ENV === "development" || !hostedArchiveEnabled()) return getManifest();
  if (hostedManifestCache && hostedManifestCache.expiresAt > Date.now()) return hostedManifestCache.manifest;
  const manifest = JSON.parse(Buffer.from(await downloadHostedManifest()).toString("utf8")) as ArchiveManifest;
  hostedManifestCache = { manifest, expiresAt: Date.now() + 5 * 60_000 };
  return manifest;
}

export async function findRuntimeAsset(assetId: string): Promise<Asset | null> {
  if (!hostedArchiveEnabled()) return findAsset(assetId);
  const manifest = await getRuntimeManifest();
  const asset = manifest.assets.find((item) => item.id === assetId);
  if (asset) return asset;
  for (const item of manifest.assets) {
    const version = item.versions?.find((candidate) => candidate.id === assetId);
    if (version) return { ...item, ...version };
  }
  return null;
}
