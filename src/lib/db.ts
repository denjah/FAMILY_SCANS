import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { neon } from "@neondatabase/serverless";
import type { ArchiveComment, ArchiveCommentRecord, CommentKind } from "@/types/archive";
import type { ArchiveSession } from "@/lib/auth";
import { databasePath, dataRoot } from "@/lib/paths";
import { hostedArchiveEnabled } from "@/lib/drive";

let database: DatabaseSync | null = null;
let hostedSchemaReady: Promise<void> | null = null;

function hostedDatabaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

export function commentStorageAvailable(): boolean {
  // SQLite is reliable for the local archive only. Hosted deployments must use
  // managed Postgres, because a Vercel function's filesystem is ephemeral.
  return !hostedArchiveEnabled() || Boolean(hostedDatabaseUrl());
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
  if (hostedArchiveEnabled()) {
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
  if (hostedArchiveEnabled()) {
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
  if (hostedArchiveEnabled()) {
    const sql = await hostedSql();
    const rows = await sql`SELECT DISTINCT asset_id FROM comments WHERE deleted_at IS NULL` as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  }
  const rows = db().prepare(`
    SELECT DISTINCT asset_id FROM comments WHERE deleted_at IS NULL
  `).all() as unknown as Array<{ asset_id: string }>;
  return rows.map((row) => row.asset_id);
}

/** Full comment records are intentionally exposed only to the owner's server page. */
export async function listAllComments(): Promise<ArchiveCommentRecord[]> {
  if (!commentStorageAvailable()) return [];
  if (hostedArchiveEnabled()) {
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
    })();
  }
  await hostedSchemaReady;
  return neon(connectionString);
}
