'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
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

// Color rides on SVG `fill`, not an inline style (the app's CSP blocks those).
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

function ItemMenu({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onToggle}
        aria-label="Actions"
        className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded-md leading-none"
      >
        &#8942;
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" aria-hidden="true" onClick={onToggle} />
          <div className="absolute right-0 mt-1 w-44 z-20 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-sm">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

const menuItemClass =
  'block w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700';

export function FolderList({
  breadcrumb,
  items,
  currentPath,
  statuses,
  isInternal,
  channelId,
  companyId,
  token,
}: {
  breadcrumb: Crumb[];
  items: FileItem[];
  currentPath: string;
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<FileItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  async function postFiles(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, companyId, ...body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: FileList) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) {
        // 1) create the pending file, get its upload URL
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            companyId,
            action: 'upload',
            path: currentPath,
            name: file.name,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Upload failed (${res.status})`);
        }
        const { uploadUrl } = await res.json();
        // 2) PUT the bytes straight to storage
        const put = await fetch(uploadUrl, { method: 'PUT', body: file });
        if (!put.ok)
          throw new Error(`Upload of "${file.name}" failed (${put.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  // Capture drag-and-drop at the window level so a file dropped anywhere on the
  // page uploads to the current folder (instead of the browser opening it).
  const uploadRef = useRef(uploadFiles);
  uploadRef.current = uploadFiles;
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer?.files?.length) uploadRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  async function changeStatus(folderId: string, statusId: string) {
    if (!channelId) return;
    setPendingId(folderId);
    setError(null);
    try {
      const res = await fetch('/api/folder-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, channelId, folderId, statusId: statusId || null }),
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
    <section
      className={
        dragOver ? 'rounded-lg outline outline-2 outline-blue-400' : ''
      }
    >
      {dragOver && (
        <div className="mb-3 p-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md">
          Drop files to upload to this folder
        </div>
      )}
      <div className="mb-4 flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1 text-sm text-gray-600 flex-wrap min-w-0">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-300">/</span>}
              {i < breadcrumb.length - 1 ? (
                <button type="button" onClick={() => navigate(crumb.path)} className="hover:underline">
                  {crumb.name}
                </button>
              ) : (
                <span className="font-medium text-gray-900">{crumb.name}</span>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          {busy && <span className="text-sm text-gray-500">Working…</span>}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setNewFolderOpen((o) => !o);
              setNewFolderName('');
            }}
            className="text-sm px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            New folder
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="text-sm px-3 py-1 rounded-md bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Upload
          </button>
        </div>
      </div>

      {newFolderOpen && (
        <div className="mb-4 flex items-center gap-2">
          <input
            type="text"
            autoFocus
            value={newFolderName}
            disabled={busy}
            placeholder="Folder name"
            onChange={(e) => setNewFolderName(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-2 py-1 w-64"
          />
          <button
            type="button"
            disabled={busy || !newFolderName.trim()}
            onClick={async () => {
              await postFiles({ action: 'newFolder', path: currentPath, name: newFolderName.trim() });
              setNewFolderOpen(false);
              setNewFolderName('');
            }}
            className="text-sm px-3 py-1 rounded-md bg-gray-900 text-white disabled:opacity-40"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setNewFolderOpen(false)}
            className="text-sm px-3 py-1 rounded-md text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      )}

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {confirmDelete && (
        <div className="mb-3 flex items-center gap-3 p-3 rounded-md border border-red-200 bg-red-50 text-sm">
          <span className="text-red-800">
            Delete &ldquo;{confirmDelete.name}&rdquo;
            {confirmDelete.object === 'folder' ? ' and everything inside it' : ''}? This
            cannot be undone.
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              const item = confirmDelete;
              setConfirmDelete(null);
              await postFiles({
                action: 'delete',
                fileId: item.id,
                path: item.path,
                object: item.object,
              });
            }}
            className="ml-auto text-sm px-3 py-1 rounded-md bg-red-600 text-white disabled:opacity-40"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(null)}
            className="text-sm px-3 py-1 rounded-md text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <Body size="base" className="text-gray-500">
          This folder is empty.
        </Body>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {items.map((item) => {
            const status = item.statusId ? statusById.get(item.statusId) : undefined;
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

                {item.object === 'folder' &&
                  (isInternal ? (
                    <div className="flex items-center gap-2 shrink-0">
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
                    </div>
                  ) : (
                    <StatusBadge status={status} />
                  ))}

                <ItemMenu
                  open={openMenuId === item.id}
                  onToggle={() =>
                    setOpenMenuId((cur) => (cur === item.id ? null : item.id))
                  }
                >
                  {item.object === 'folder' && (
                    <a
                      href={folderZipHref(item.path)}
                      target="_blank"
                      rel="noreferrer"
                      className={menuItemClass}
                      onClick={() => setOpenMenuId(null)}
                    >
                      Download (.zip)
                    </a>
                  )}
                  {item.object === 'file' && (
                    <a
                      href={downloadHref(item.id)}
                      target="_blank"
                      rel="noreferrer"
                      className={menuItemClass}
                      onClick={() => setOpenMenuId(null)}
                    >
                      Download
                    </a>
                  )}
                  {item.object === 'link' && item.linkUrl && (
                    <a
                      href={item.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={menuItemClass}
                      onClick={() => setOpenMenuId(null)}
                    >
                      Open link
                    </a>
                  )}
                  <button
                    type="button"
                    className={`${menuItemClass} text-red-600`}
                    onClick={() => {
                      setOpenMenuId(null);
                      setConfirmDelete(item);
                    }}
                  >
                    Delete
                  </button>
                </ItemMenu>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
