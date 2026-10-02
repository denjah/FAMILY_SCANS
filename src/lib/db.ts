import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { neon } from "@neondatabase/serverless";
import type { ArchiveComment, ArchiveCommentPreview, ArchiveCommentRecord, AssetMetadata, CommentKind } from "@/types/archive";
import type { ArchiveSession } from "@/lib/auth";
import { databasePath, dataRoot } from "@/lib/paths";
import { hostedArchiveEnabled } from "@/lib/drive";

let database: DatabaseSync | null = null;
let hostedSchemaReady: Promise<void> | null = null;

function hostedDatabaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

function hostedRuntime(): boolean {
  return process.env.VERCEL === "1"
    || Boolean(process.env.VERCEL_ENV)
    || (process.env.NODE_ENV === "production" && hostedArchiveEnabled());
}

function useHostedDatabase(): boolean {
  return Boolean(hostedDatabaseUrl() && (hostedRuntime() || hostedArchiveEnabled()));
}

export function commentStorageAvailable(): boolean {
  // SQLite is reliable for the local archive only. Hosted deployments must use
  // managed Postgres, because a Vercel function's filesystem is ephemeral.
  return !hostedRuntime() || Boolean(hostedDatabaseUrl());
}

export function hostedCommentDatabase(): boolean {
  return useHostedDatabase();
}

function db(): DatabaseSync {
  if (database) return database;
  fs.mkdirSync(dataRoot(), { recursive: true });
  database = new DatabaseSync(databasePath());
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_display_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('comment','memory','correction','identification','date_suggestion')),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_comments_asset_created ON comments(asset_id, created_at);
    CREATE TABLE IF NOT EXISTS asset_metadata (
      asset_id TEXT PRIMARY KEY,
      names TEXT NOT NULL DEFAULT '' CHECK(length(names) <= 500),
      year TEXT NOT NULL DEFAULT '' CHECK(length(year) <= 40),
      caption TEXT NOT NULL DEFAULT '' CHECK(length(caption) <= 2000),
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}

type CommentRow = {
  id: string;
  asset_id: string;
  author_id: string;
  author_display_name: string;
  kind: CommentKind;
  body: string;
  created_at: string;
  updated_at: string;
  revision: number;
};

function mapComment(row: CommentRow, session: ArchiveSession): ArchiveComment {
  return {
    id: row.id,
    assetId: row.asset_id,
    authorDisplayName: row.author_display_name,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    mine: row.author_id === session.sub || session.role === "admin",
  };
}

export async function listComments(assetId: string, session: ArchiveSession): Promise<ArchiveComment[]> {
  if (!commentStorageAvailable()) return [];
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    const rows = await sql`
      SELECT id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at, revision
      FROM comments WHERE asset_id = ${assetId} AND deleted_at IS NULL ORDER BY created_at ASC
    ` as CommentRow[];
    return rows.map((row) => mapComment(row, session));
  }
  const rows = db().prepare(`
    SELECT id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at, revision
    FROM comments WHERE asset_id = ? AND deleted_at IS NULL ORDER BY created_at ASC
  `).all(assetId) as unknown as CommentRow[];
  return rows.map((row) => mapComment(row, session));
}

export async function createComment(
  id: string,
  assetId: string,
  kind: CommentKind,
  body: string,
  session: ArchiveSession,
): Promise<ArchiveComment> {
  if (!commentStorageAvailable()) throw new Error("Comment storage is not configured");
  const now = new Date().toISOString();
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    await sql`
      INSERT INTO comments (id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at)
      VALUES (${id}, ${assetId}, ${session.sub}, ${session.displayName}, ${kind}, ${body}, ${now}, ${now})
    `;
    return {
      id,
      assetId,
      authorDisplayName: session.displayName,
      kind,
      body,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      mine: true,
    };
  }
  db().prepare(`
    INSERT INTO comments (id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, assetId, session.sub, session.displayName, kind, body, now, now);
  return (await listComments(assetId, session)).find((comment) => comment.id === id)!;
}

export async function commentedAssetIds(): Promise<string[]> {
  if (!commentStorageAvailable()) return [];
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    const rows = await sql`SELECT DISTINCT asset_id FROM comments WHERE deleted_at IS NULL` as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  }
  const rows = db().prepare(`
    SELECT DISTINCT asset_id FROM comments WHERE deleted_at IS NULL
  `).all() as unknown as Array<{ asset_id: string }>;
  return rows.map((row) => row.asset_id);
}

type MetadataRow = { asset_id: string; names: string; year: string; caption: string; updated_at: string };

function mapMetadata(row: MetadataRow): AssetMetadata {
  return { assetId: row.asset_id, names: row.names, year: row.year, caption: row.caption, updatedAt: row.updated_at };
}

export async function listAssetMetadata(): Promise<AssetMetadata[]> {
  if (!commentStorageAvailable()) return [];
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    const rows = await sql`SELECT asset_id, names, year, caption, updated_at FROM asset_metadata` as MetadataRow[];
    return rows.map(mapMetadata);
  }
  const rows = db().prepare("SELECT asset_id, names, year, caption, updated_at FROM asset_metadata").all() as unknown as MetadataRow[];
  return rows.map(mapMetadata);
}

export async function saveAssetMetadata(assetId: string, values: Pick<AssetMetadata, "names" | "year" | "caption">): Promise<AssetMetadata> {
  if (!commentStorageAvailable()) throw new Error("Metadata storage is not configured");
  const updatedAt = new Date().toISOString();
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    await sql`
      INSERT INTO asset_metadata (asset_id, names, year, caption, updated_at)
      VALUES (${assetId}, ${values.names}, ${values.year}, ${values.caption}, ${updatedAt})
      ON CONFLICT (asset_id) DO UPDATE SET names = EXCLUDED.names, year = EXCLUDED.year, caption = EXCLUDED.caption, updated_at = EXCLUDED.updated_at
    `;
  } else {
    db().prepare(`
      INSERT INTO asset_metadata (asset_id, names, year, caption, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET names = excluded.names, year = excluded.year, caption = excluded.caption, updated_at = excluded.updated_at
    `).run(assetId, values.names, values.year, values.caption, updatedAt);
  }
  return { assetId, ...values, updatedAt };
}

/** Full comment records are intentionally exposed only to the owner's server page. */
export async function listAllComments(): Promise<ArchiveCommentRecord[]> {
  if (!commentStorageAvailable()) return [];
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    const rows = await sql`
      SELECT id, asset_id, author_display_name, kind, body, created_at, updated_at, revision
      FROM comments WHERE deleted_at IS NULL ORDER BY created_at DESC
    ` as Array<Omit<CommentRow, "author_id">>;
    return rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      authorDisplayName: row.author_display_name,
      kind: row.kind,
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
    }));
  }
  const rows = db().prepare(`
    SELECT id, asset_id, author_display_name, kind, body, created_at, updated_at, revision
    FROM comments WHERE deleted_at IS NULL ORDER BY created_at DESC
  `).all() as unknown as Array<Omit<CommentRow, "author_id">>;
  return rows.map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    authorDisplayName: row.author_display_name,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  }));
}

export interface CommentSyncRecord extends ArchiveCommentRecord {
  authorId: string;
  deletedAt: string | null;
}

/** Full records for authenticated synchronization between the local and hosted stores. */
export async function listCommentsForSync(): Promise<CommentSyncRecord[]> {
  if (!commentStorageAvailable()) return [];
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    const rows = await sql`
      SELECT id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at, revision, deleted_at
      FROM comments ORDER BY created_at ASC
    ` as Array<CommentRow & { deleted_at: string | null }>;
    return rows.map((row) => ({
      id: row.id, assetId: row.asset_id, authorId: row.author_id,
      authorDisplayName: row.author_display_name, kind: row.kind, body: row.body,
      createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
      deletedAt: row.deleted_at,
    }));
  }
  const rows = db().prepare(`
    SELECT id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at, revision, deleted_at
    FROM comments ORDER BY created_at ASC
  `).all() as unknown as Array<CommentRow & { deleted_at: string | null }>;
  return rows.map((row) => ({
    id: row.id, assetId: row.asset_id, authorId: row.author_id,
    authorDisplayName: row.author_display_name, kind: row.kind, body: row.body,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
    deletedAt: row.deleted_at,
  }));
}

/** Merge without deleting remote data; matching IDs retain the newest revision. */
export async function mergeCommentsForSync(records: CommentSyncRecord[]): Promise<void> {
  if (!commentStorageAvailable()) throw new Error("Comment storage is not configured");
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    for (const row of records) {
      await sql`
        INSERT INTO comments (id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at, deleted_at, revision)
        VALUES (${row.id}, ${row.assetId}, ${row.authorId}, ${row.authorDisplayName}, ${row.kind}, ${row.body}, ${row.createdAt}, ${row.updatedAt}, ${row.deletedAt}, ${row.revision})
        ON CONFLICT (id) DO UPDATE SET
          asset_id = EXCLUDED.asset_id, author_id = EXCLUDED.author_id,
          author_display_name = EXCLUDED.author_display_name, kind = EXCLUDED.kind,
          body = EXCLUDED.body, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at,
          deleted_at = EXCLUDED.deleted_at, revision = EXCLUDED.revision
        WHERE EXCLUDED.revision > comments.revision OR (EXCLUDED.revision = comments.revision AND EXCLUDED.updated_at > comments.updated_at)
      `;
    }
    return;
  }
  const insert = db().prepare(`
    INSERT INTO comments (id, asset_id, author_id, author_display_name, kind, body, created_at, updated_at, deleted_at, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      asset_id=excluded.asset_id, author_id=excluded.author_id,
      author_display_name=excluded.author_display_name, kind=excluded.kind,
      body=excluded.body, created_at=excluded.created_at, updated_at=excluded.updated_at,
      deleted_at=excluded.deleted_at, revision=excluded.revision
    WHERE excluded.revision > comments.revision OR (excluded.revision = comments.revision AND excluded.updated_at > comments.updated_at)
  `);
  db().exec("BEGIN");
  try {
    for (const row of records) insert.run(
      row.id, row.assetId, row.authorId, row.authorDisplayName, row.kind, row.body,
      row.createdAt, row.updatedAt, row.deletedAt, row.revision,
    );
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}

/** Minimal active comment data used to show comments beside archive grid items. */
export async function listCommentPreviews(): Promise<ArchiveCommentPreview[]> {
  if (!commentStorageAvailable()) return [];
  let rows: Array<Pick<CommentRow, "id" | "asset_id" | "author_display_name" | "kind" | "body" | "created_at">>;
  if (useHostedDatabase()) {
    const sql = await hostedSql();
    rows = await sql`
      SELECT id, asset_id, author_display_name, kind, body, created_at
      FROM comments WHERE deleted_at IS NULL ORDER BY created_at ASC
    ` as typeof rows;
  } else {
    rows = db().prepare(`
      SELECT id, asset_id, author_display_name, kind, body, created_at
      FROM comments WHERE deleted_at IS NULL ORDER BY created_at ASC
    `).all() as unknown as typeof rows;
  }
  return rows.map((row) => ({
    id: row.id,
    assetId: row.asset_id,
    authorDisplayName: row.author_display_name,
    kind: row.kind,
    body: row.body,
    createdAt: row.created_at,
  }));
}

async function hostedSql() {
  const connectionString = hostedDatabaseUrl();
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!hostedSchemaReady) {
    const schemaSql = neon(connectionString);
    hostedSchemaReady = (async () => {
      await schemaSql`CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_display_name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('comment','memory','correction','identification','date_suggestion')),
        body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 5000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1
      )`;
      await schemaSql`CREATE INDEX IF NOT EXISTS idx_comments_asset_created ON comments(asset_id, created_at)`;
      await schemaSql`CREATE TABLE IF NOT EXISTS asset_metadata (
        asset_id TEXT PRIMARY KEY,
        names TEXT NOT NULL DEFAULT '',
        year TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )`;
    })();
  }
  await hostedSchemaReady;
  return neon(connectionString);
}
