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
    await sql`CREATE TABLE IF NOT EXISTS status_history (
      id bigserial PRIMARY KEY,
      channel_id   text NOT NULL,
      folder_id    text NOT NULL,
      status_id    text,
      status_label text,
      status_color text,
      changed_by   text,
      changed_at   timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS status_history_folder_idx
              ON status_history (channel_id, folder_id, changed_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS folder_archive (
      channel_id  text NOT NULL,
      folder_id   text NOT NULL,
      archived_by text,
      archived_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, folder_id)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS file_creator (
      channel_id   text NOT NULL,
      file_id      text NOT NULL,
      creator_name text,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (channel_id, file_id)
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

  // Snapshot the change into history (label/color captured now so the audit
  // trail stays accurate even if the status is later renamed or deleted).
  let label = 'No status';
  let color: string | null = null;
  if (statusId) {
    const s = (await sql`SELECT label, color FROM statuses WHERE id = ${statusId}`) as {
      label: string;
      color: string;
    }[];
    if (s[0]) {
      label = s[0].label;
      color = s[0].color;
    }
  }
  await sql`INSERT INTO status_history
              (channel_id, folder_id, status_id, status_label, status_color, changed_by)
            VALUES (${channelId}, ${folderId}, ${statusId}, ${label}, ${color}, ${updatedBy ?? null})`;
}

// A folder is archived (hidden from the active jobs list) if it has a row here.
// Shared: one flag per folder, affecting both internal and client views.
export async function getArchivedSet(channelId: string): Promise<Set<string>> {
  const sql = await ready();
  if (!sql) return new Set();
  const rows = (await sql`SELECT folder_id FROM folder_archive
                          WHERE channel_id = ${channelId}`) as {
    folder_id: string;
  }[];
  return new Set(rows.map((r) => r.folder_id));
}

export async function setArchived(
  channelId: string,
  folderId: string,
  archived: boolean,
  by?: string,
): Promise<void> {
  const sql = await ready();
  if (!sql) throw new Error('Database not configured');
  if (archived) {
    await sql`INSERT INTO folder_archive (channel_id, folder_id, archived_by)
              VALUES (${channelId}, ${folderId}, ${by ?? null})
              ON CONFLICT (channel_id, folder_id) DO NOTHING`;
  } else {
    await sql`DELETE FROM folder_archive
              WHERE channel_id = ${channelId} AND folder_id = ${folderId}`;
  }
}

// Who created a file/folder through our app. We record this ourselves because
// our API calls use the workspace key, so Assembly credits the workspace (not
// the person). file_id -> creator display name for a channel.
export async function getFileCreatorMap(
  channelId: string,
): Promise<Map<string, string>> {
  const sql = await ready();
  const map = new Map<string, string>();
  if (!sql) return map;
  const rows = (await sql`SELECT file_id, creator_name FROM file_creator
                          WHERE channel_id = ${channelId} AND creator_name IS NOT NULL`) as {
    file_id: string;
    creator_name: string;
  }[];
  for (const r of rows) map.set(r.file_id, r.creator_name);
  return map;
}

export async function setFileCreator(
  channelId: string,
  fileId: string,
  creatorName: string,
): Promise<void> {
  const sql = await ready();
  if (!sql) return; // best-effort; never fail a create over creator tracking
  await sql`INSERT INTO file_creator (channel_id, file_id, creator_name)
            VALUES (${channelId}, ${fileId}, ${creatorName})
            ON CONFLICT (channel_id, file_id) DO NOTHING`;
}

export interface HistoryRow {
  statusLabel: string;
  statusColor: string | null;
  changedBy: string | null;
  changedAt: string;
}

export async function getFolderHistory(
  channelId: string,
  folderId: string,
): Promise<HistoryRow[]> {
  const sql = await ready();
  if (!sql) return [];
  const rows = (await sql`SELECT status_label, status_color, changed_by, changed_at
                          FROM status_history
                          WHERE channel_id = ${channelId} AND folder_id = ${folderId}
                          ORDER BY changed_at DESC LIMIT 200`) as {
    status_label: string | null;
    status_color: string | null;
    changed_by: string | null;
    changed_at: string;
  }[];
  return rows.map((r) => ({
    statusLabel: r.status_label ?? 'No status',
    statusColor: r.status_color,
    changedBy: r.changed_by,
    changedAt: r.changed_at,
  }));
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
