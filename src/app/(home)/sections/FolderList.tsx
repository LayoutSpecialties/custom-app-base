'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Body, Heading } from '@assembly-js/design-system';
import type { FolderItem } from '@/utils/files';
import type { StatusDef } from '@/utils/status';
import { UNSET_COLOR } from '@/utils/status';

function FolderIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0 text-gray-400"
      aria-hidden="true"
    >
      <path
        d="M3 6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

function StatusBadge({ status }: { status?: StatusDef }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
      <StatusDot color={status?.color ?? UNSET_COLOR} />
      {status?.label ?? 'No status'}
    </span>
  );
}

export function FolderList({
  companyName,
  folders,
  statuses,
  isInternal,
  channelId,
  token,
}: {
  companyName?: string;
  folders: FolderItem[];
  statuses: StatusDef[];
  isInternal: boolean;
  channelId?: string;
  token?: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  async function changeStatus(folderId: string, statusId: string) {
    if (!channelId) return;
    setPendingId(folderId);
    setError(null);
    try {
      const res = await fetch('/api/folder-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          channelId,
          folderId,
          statusId: statusId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section>
      <div className="mb-6">
        <Heading size="xl">Files</Heading>
        {companyName && (
          <Body size="base" className="text-gray-500 mt-1">
            {companyName}
          </Body>
        )}
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {isInternal && (
        <pre className="mb-4 p-2 bg-gray-100 text-xs overflow-auto rounded border border-gray-200">
          {JSON.stringify({ statuses, folders }, null, 2)}
        </pre>
      )}

      {folders.length === 0 ? (
        <Body size="base" className="text-gray-500">
          No folders yet.
        </Body>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {folders.map((folder) => {
            const status = folder.statusId
              ? statusById.get(folder.statusId)
              : undefined;
            return (
              <li
                key={folder.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <FolderIcon />
                <span className="font-medium text-gray-900 flex-1 truncate">
                  {folder.name}
                </span>
                {isInternal ? (
                  <div className="flex items-center gap-2">
                    <StatusDot color={status?.color ?? UNSET_COLOR} />
                    <select
                      className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white disabled:opacity-50"
                      value={folder.statusId ?? ''}
                      disabled={pendingId === folder.id}
                      onChange={(e) => changeStatus(folder.id, e.target.value)}
                    >
                      <option value="">No status</option>
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <StatusBadge status={status} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
