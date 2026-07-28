'use client';

import { useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Body } from '@assembly-js/design-system';
import type { FileItem, Crumb } from '@/utils/files';
import type { StatusDef } from '@/utils/status';
import { UNSET_COLOR } from '@/utils/status';

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-gray-400" aria-hidden="true">
      <path d="M3 6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" fill="currentColor" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-gray-400" aria-hidden="true">
      <path d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="currentColor" />
      <path d="M13 2v5h5" fill="#fff" fillOpacity="0.35" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0 text-gray-400" aria-hidden="true">
      <path d="M10 13a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7L11 6.3M14 11a4 4 0 0 0-5.7 0L6 13.3a4 4 0 1 0 5.7 5.7L13 17.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// Rendered as SVG so the color rides on `fill`, not an inline style (the app's
// CSP blocks inline style attributes).
function StatusDot({ color }: { color: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill={color} />
    </svg>
  );
}

function StatusBadge({ status }: { status?: StatusDef }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-gray-700 shrink-0">
      <StatusDot color={status?.color ?? UNSET_COLOR} />
      {status?.label ?? 'No status'}
    </span>
  );
}

export function FolderList({
  breadcrumb,
  items,
  statuses,
  isInternal,
  channelId,
  companyId,
  token,
}: {
  breadcrumb: Crumb[];
  items: FileItem[];
  statuses: StatusDef[];
  isInternal: boolean;
  channelId?: string;
  companyId?: string;
  token?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusById = new Map(statuses.map((s) => [s.id, s]));

  function navigate(path: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (path) params.set('path', path);
    else params.delete('path');
    router.push(`${pathname}?${params.toString()}`);
  }

  function downloadHref(fileId: string) {
    const params = new URLSearchParams();
    params.set('fileId', fileId);
    if (token) params.set('token', token);
    return `/api/download?${params.toString()}`;
  }

  function folderZipHref(path: string) {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (token) params.set('token', token);
    if (companyId) params.set('companyId', companyId);
    return `/api/download-folder?${params.toString()}`;
  }

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
      <nav className="mb-4 flex items-center gap-1 text-sm text-gray-600 flex-wrap">
        {breadcrumb.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-300">/</span>}
            {i < breadcrumb.length - 1 ? (
              <button
                type="button"
                onClick={() => navigate(crumb.path)}
                className="hover:underline"
              >
                {crumb.name}
              </button>
            ) : (
              <span className="font-medium text-gray-900">{crumb.name}</span>
            )}
          </span>
        ))}
      </nav>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {items.length === 0 ? (
        <Body size="base" className="text-gray-500">
          This folder is empty.
        </Body>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {items.map((item) => {
            const status = item.statusId
              ? statusById.get(item.statusId)
              : undefined;
            return (
              <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                {item.object === 'folder' && <FolderIcon />}
                {item.object === 'file' && <FileIcon />}
                {item.object === 'link' && <LinkIcon />}

                {item.object === 'folder' ? (
                  <button
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="font-medium text-gray-900 flex-1 min-w-0 truncate text-left hover:underline"
                  >
                    {item.name}
                  </button>
                ) : (
                  <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">
                    {item.name}
                  </span>
                )}

                {item.object === 'folder' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={folderZipHref(item.path)}
                      target="_blank"
                      rel="noreferrer"
                      title="Download this folder as a .zip"
                      className="text-sm px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Download
                    </a>
                    {isInternal ? (
                      <>
                        <StatusDot color={status?.color ?? UNSET_COLOR} />
                        <select
                          className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white disabled:opacity-50"
                          value={item.statusId ?? ''}
                          disabled={pendingId === item.id}
                          onChange={(e) => changeStatus(item.id, e.target.value)}
                        >
                          <option value="">No status</option>
                          {statuses.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <StatusBadge status={status} />
                    )}
                  </div>
                )}

                {item.object === 'file' && (
                  <a
                    href={downloadHref(item.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 shrink-0"
                  >
                    Download
                  </a>
                )}

                {item.object === 'link' && item.linkUrl && (
                  <a
                    href={item.linkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 shrink-0"
                  >
                    Open
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
