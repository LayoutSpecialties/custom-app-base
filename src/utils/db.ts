import { neon } from '@neondatabase/serverless';
import { DEFAULT_STATUSES, toStatusId, type StatusDef } from '@/utils/status';

// Lazily resolve a SQL client. Returns null when no connection string is set,
// so the app degrades gracefully (folders still list; statuses are just empty)
// before the database is wired up in Vercel.
let cached: ReturnType<typeof neon> | null | undefined;
let schemaReady = false;

function getSql() {
  if (cached === undefined) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    cached = url ? neon(url) : null;
  }
  return cached;
}

export function isDbConfigured(): boolean {
  return getSql() !== null;
}

// Create tables on first use and seed the default statuses into an empty table.
// Idempotent and safe under concurrent cold starts (IF NOT EXISTS / ON CONFLICT).
async function ready() {
  const sql = getSql();
  if (!sql) return null;
  if (!schemaReady) {
    await sql`CREATE TABLE IF NOT EXISTS statuses (
      id text PRIMARY KEY,
      label text NOT NULL,
      color text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS folder_status (
      channel_id text NOT NULL,
      folder_id  text NOT NULL,
      status_id  text,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, folder_id)
    )`;
    const existing = (await sql`SELECT count(*)::int AS n FROM statuses`) as {
      n: number;
    }[];
    if ((existing[0]?.n ?? 0) === 0) {
      for (const s of DEFAULT_STATUSES) {
        await sql`INSERT INTO statuses (id, label, color, sort_order)
                  VALUES (${toStatusId(s.label)}, ${s.label}, ${s.color}, ${s.sortOrder})
                  ON CONFLICT (id) DO NOTHING`;
      }
    }
    schemaReady = true;
  }
  return sql;
}

export async function listStatuses(): Promise<StatusDef[]> {
  const sql = await ready();
  if (!sql) return [];
  const rows = (await sql`SELECT id, label, color, sort_order
                          FROM statuses ORDER BY sort_order, label`) as {
    id: string;
    label: string;
    color: string;
    sort_order: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    color: r.color,
    sortOrder: r.sort_order,
  }));
}

// folder_id -> status_id for a channel (only folders with a status set).
export async function getFolderStatusMap(
  channelId: string,
): Promise<Record<string, string>> {
  const sql = await ready();
  if (!sql) return {};
  const rows = (await sql`SELECT folder_id, status_id FROM folder_status
                          WHERE channel_id = ${channelId} AND status_id IS NOT NULL`) as {
    folder_id: string;
    status_id: string;
  }[];
  const map: Record<string, string> = {};
  for (const r of rows) map[r.folder_id] = r.status_id;
  return map;
}

export async function setFolderStatus(
  channelId: string,
  folderId: string,
  statusId: string | null,
  updatedBy?: string,
): Promise<void> {
  const sql = await ready();
  if (!sql) throw new Error('Database not configured');
  await sql`INSERT INTO folder_status (channel_id, folder_id, status_id, updated_by, updated_at)
            VALUES (${channelId}, ${folderId}, ${statusId}, ${updatedBy ?? null}, now())
            ON CONFLICT (channel_id, folder_id)
            DO UPDATE SET status_id = EXCLUDED.status_id,
                          updated_by = EXCLUDED.updated_by,
                          updated_at = now()`;
}

// ── Status category management (internal only; callers enforce the role) ──────

export async function createStatus(label: string, color: string): Promise<void> {
  const sql = await ready();
  if (!sql) throw new Error('Database not configured');

  // Derive a unique id from the label.
  const base = toStatusId(label);
  const existing = (await sql`SELECT id FROM statuses WHERE id = ${base} OR id LIKE ${base + '_%'}`) as {
    id: string;
  }[];
  const taken = new Set(existing.map((r) => r.id));
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;

  const maxRow = (await sql`SELECT COALESCE(MAX(sort_order), -1) AS m FROM statuses`) as {
    m: number;
  }[];
  const sortOrder = (maxRow[0]?.m ?? -1) + 1;

  await sql`INSERT INTO statuses (id, label, color, sort_order)
            VALUES (${id}, ${label}, ${color}, ${sortOrder})`;
}

export async function updateStatus(
  id: string,
  label: string,
  color: string,
): Promise<void> {
  const sql = await ready();
  if (!sql) throw new Error('Database not configured');
  // id stays stable so existing folder assignments remain valid.
  await sql`UPDATE statuses SET label = ${label}, color = ${color} WHERE id = ${id}`;
}

export async function deleteStatus(id: string): Promise<void> {
  const sql = await ready();
  if (!sql) throw new Error('Database not configured');
  // Any folders using this status fall back to "No status".
  await sql`UPDATE folder_status SET status_id = NULL WHERE status_id = ${id}`;
  await sql`DELETE FROM statuses WHERE id = ${id}`;
}

export async function setStatusOrder(orderedIds: string[]): Promise<void> {
  const sql = await ready();
  if (!sql) throw new Error('Database not configured');
  for (let i = 0; i < orderedIds.length; i++) {
    await sql`UPDATE statuses SET sort_order = ${i} WHERE id = ${orderedIds[i]}`;
  }
}
