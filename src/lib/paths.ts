import path from "node:path";

export const projectRoot = process.cwd();

export function archiveRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.ARCHIVE_ROOT || "Z:/SCAN");
}

export function dataRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.ARCHIVE_DATA_ROOT || path.join(projectRoot, "data"));
}

export function derivativesRoot(): string {
  return path.resolve(/* turbopackIgnore: true */
    process.env.ARCHIVE_DERIVATIVES_ROOT || path.join(projectRoot, "generated", "previews"),
  );
}

export function manifestPath(): string {
  return path.join(dataRoot(), "archive-index.json");
}

export function databasePath(): string {
  return path.join(dataRoot(), "archive.sqlite");
}

export function resolveInside(root: string, relativePath: string): string {
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, relativePath);
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  if (candidate !== normalizedRoot && !candidate.startsWith(prefix)) {
    throw new Error("Path escapes configured root");
  }
  return candidate;
}
