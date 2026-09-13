export type AssetKind = "photo" | "document" | "video" | "project" | "unknown";
export type TakenAtPrecision = "exact" | "month" | "year" | "decade" | "estimated" | "unknown";
export type CommentKind = "comment" | "memory" | "correction" | "identification" | "date_suggestion";

export interface AssetTechnicalMetadata {
  extension: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  pages: number | null;
  modifiedAt: string;
}

export interface EmbeddedNote {
  title?: string;
  body: string;
  source: "EXIF" | "XMP";
}

export interface AssetVersion {
  id: string;
  relativePath: string;
  fileName: string;
  technicalMetadata: AssetTechnicalMetadata;
  webPreview: boolean;
  versionHint: string | null;
  embeddedNotes?: EmbeddedNote[];
}

export interface Asset {
  id: string;
  relativePath: string;
  fileName: string;
  kind: AssetKind;
  title: string;
  caption: string;
  branch: string;
  technicalMetadata: AssetTechnicalMetadata;
  takenAt: string | null;
  takenAtPrecision: TakenAtPrecision;
  sensitive: boolean;
  webPreview: boolean;
  versionHint: string | null;
  side: "front" | "back" | "single" | "unknown";
  embeddedNotes?: EmbeddedNote[];
  /** The selected version is always first; the rest are earlier alternatives. */
  versions?: AssetVersion[];
}

export interface ArchiveManifest {
  generatedAt: string;
  archiveRoot: string;
  assetCount: number;
  errorCount: number;
  assets: Asset[];
  errors: Array<{ relativePath: string; message: string }>;
}

export interface ArchiveComment {
  id: string;
  assetId: string;
  authorDisplayName: string;
  kind: CommentKind;
  body: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  mine: boolean;
}

/** A comment as shown in the owner's audit table. */
export interface ArchiveCommentRecord {
  id: string;
  assetId: string;
  authorDisplayName: string;
  kind: CommentKind;
  body: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
