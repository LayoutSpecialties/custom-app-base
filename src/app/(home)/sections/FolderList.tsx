'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Body, Heading } from '@assembly-js/design-system';
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

type HistoryEntry = {
  statusLabel: string;
  statusColor: string | null;
  changedByName: string | null;
  changedAt: string;
};

type Upload = { file: File; relPath: string };

// Read every entry from a directory reader (it returns them in batches).
function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const read = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          read();
        }
      }, reject);
    read();
  });
}

// Expand a drop into files with their relative paths, walking into folders.
async function uploadsFromDataTransfer(dt: DataTransfer): Promise<Upload[]> {
  const roots: FileSystemEntry[] = [];
  for (let i = 0; i < dt.items.length; i++) {
    const entry = dt.items[i].webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  if (roots.length === 0) {
    return Array.from(dt.files).map((file) => ({ file, relPath: file.name }));
  }
  const out: Upload[] = [];
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej),
      );
      out.push({ file, relPath: prefix + entry.name });
    } else if (entry.isDirectory) {
      const children = await readAllEntries(
        (entry as FileSystemDirectoryEntry).createReader(),
      );
      for (const c of children) await walk(c, `${prefix}${entry.name}/`);
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

export function FolderList({
  breadcrumb,
  items,
  archivedFolders,
  currentPath,
  statuses,
  isInternal,
  channelId,
  companyId,
  token,
}: {
  breadcrumb: Crumb[];
  items: FileItem[];
  archivedFolders: FileItem[];
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
  const [historyItem, setHistoryItem] = useState<FileItem | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sortKey, setSortKey] = useState<'name' | 'status' | 'modified'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [confirmArchive, setConfirmArchive] = useState<FileItem | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pendingNotifyRef = useRef<string[]>([]);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Client uploads are batched: after the last upload we wait 60s (each new
  // upload resets the wait) then send ONE grouped email. Tab close flushes now.
  function flushNotifications() {
    if (notifyTimerRef.current) {
      clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = null;
    }
    const fileNames = pendingNotifyRef.current;
    if (fileNames.length === 0) return;
    pendingNotifyRef.current = [];
    fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, companyId, action: 'notifyUpload', fileNames }),
      keepalive: true,
    }).catch(() => {});
  }

  function queueNotification(paths: string[]) {
    if (paths.length === 0) return;
    pendingNotifyRef.current.push(...paths);
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(flushNotifications, 60000);
  }

  async function uploadEntries(uploads: Upload[]) {
    if (uploads.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // 1) create any subfolders these files need (shallowest first)
      const folderSet = new Set<string>();
      for (const { relPath } of uploads) {
        const parts = relPath.split('/');
        parts.pop(); // filename
        let rel = '';
        for (const p of parts) {
          rel = rel ? `${rel}/${p}` : p;
          folderSet.add([currentPath, rel].filter(Boolean).join('/'));
        }
      }
      const folderPaths = Array.from(folderSet).sort(
        (a, b) => a.split('/').length - b.split('/').length,
      );
      if (folderPaths.length > 0) {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            companyId,
            action: 'ensureFolders',
            paths: folderPaths,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Failed to create folders');
        }
      }

      // 2) create each pending file and PUT its bytes to storage
      for (const { file, relPath } of uploads) {
        const parts = relPath.split('/');
        const name = parts.pop() as string;
        const parentPath = [currentPath, ...parts].filter(Boolean).join('/');
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            companyId,
            action: 'upload',
            path: parentPath,
            name,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Upload failed (${res.status})`);
        }
        const { uploadUrl } = await res.json();
        const put = await fetch(uploadUrl, { method: 'PUT', body: file });
        if (!put.ok)
          throw new Error(`Upload of "${name}" failed (${put.status})`);
      }
      // Notify the internal team when a client uploads (batched; see queue).
      if (!isInternal) {
        queueNotification(
          uploads.map((u) =>
            [currentPath, u.relPath].filter(Boolean).join('/'),
          ),
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  function uploadFileList(files: FileList) {
    // Folder picker gives webkitRelativePath (e.g. "MyFolder/sub/a.txt");
    // plain file picker leaves it empty, so fall back to the file name.
    uploadEntries(
      Array.from(files).map((file) => ({
        file,
        relPath:
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name,
      })),
    );
  }

  async function uploadDataTransfer(dt: DataTransfer) {
    uploadEntries(await uploadsFromDataTransfer(dt));
  }

  // Capture drag-and-drop at the window level so a file dropped anywhere on the
  // page uploads to the current folder (instead of the browser opening it).
  const uploadRef = useRef(uploadDataTransfer);
  uploadRef.current = uploadDataTransfer;
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
      if (
        e.dataTransfer &&
        (e.dataTransfer.items?.length || e.dataTransfer.files?.length)
      ) {
        uploadRef.current(e.dataTransfer);
      }
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

  // Flush any pending upload notification if the tab is closing, so a batch
  // isn't lost before its 60s timer fires.
  useEffect(() => {
    const flushOnHide = () => {
      const fileNames = pendingNotifyRef.current;
      if (fileNames.length === 0) return;
      pendingNotifyRef.current = [];
      const body = JSON.stringify({
        token,
        companyId,
        action: 'notifyUpload',
        fileNames,
      });
      navigator.sendBeacon?.(
        '/api/files',
        new Blob([body], { type: 'application/json' }),
      );
    };
    window.addEventListener('pagehide', flushOnHide);
    return () => {
      window.removeEventListener('pagehide', flushOnHide);
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    };
  }, [token, companyId]);

  async function openHistory(item: FileItem) {
    if (!channelId) return;
    setHistoryItem(item);
    setHistoryEntries(null);
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/folder-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, channelId, folderId: item.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to load history');
      setHistoryEntries(j.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setHistoryItem(null);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function setArchived(item: FileItem, archived: boolean) {
    if (!channelId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/folder-archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          channelId,
          folderId: item.id,
          archived,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update archive');
    } finally {
      setBusy(false);
    }
  }

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

  function toggleSort(col: 'name' | 'status' | 'modified') {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDir('asc');
    }
  }
  const arrow = (col: string) =>
    sortKey === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  // "No status" ranks before all real statuses (which run 0..n in your list
  // order). So ascending goes No status -> ... -> Complete, and descending
  // reverses it (Complete -> ... -> No status). Files stay below via grouping.
  const statusRank = (x: FileItem) => {
    if (x.object !== 'folder') return Number.MAX_SAFE_INTEGER;
    if (!x.statusId) return -1;
    return statusById.get(x.statusId)?.sortOrder ?? -1;
  };

  // Folders always stay on top; the chosen column sorts within each group.
  const sortedItems = [...items].sort((a, b) => {
    const fr = (a.object === 'folder' ? 0 : 1) - (b.object === 'folder' ? 0 : 1);
    if (fr !== 0) return fr;
    let r = 0;
    if (sortKey === 'name') r = a.name.localeCompare(b.name);
    else if (sortKey === 'modified')
      r = (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
    else {
      r = statusRank(a) - statusRank(b);
      if (r === 0) r = a.name.localeCompare(b.name);
    }
    return sortDir === 'asc' ? r : -r;
  });

  const formatDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  };

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
          {currentPath === '' && (
            <button
              type="button"
              onClick={() => setShowArchived(true)}
              className="text-sm px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Archived{archivedFolders.length ? ` (${archivedFolders.length})` : ''}
            </button>
          )}
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
              if (e.target.files) uploadFileList(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) uploadFileList(e.target.files);
              e.target.value = '';
            }}
            {...({ webkitdirectory: '', directory: '' } as Record<
              string,
              string
            >)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => folderInputRef.current?.click()}
            className="text-sm px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Upload folder
          </button>
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
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500">
            <button
              type="button"
              onClick={() => toggleSort('name')}
              className="flex-1 min-w-0 text-left hover:text-gray-700"
            >
              Name{arrow('name')}
            </button>
            <button
              type="button"
              onClick={() => toggleSort('status')}
              className="w-52 shrink-0 text-left hover:text-gray-700"
            >
              Status{arrow('status')}
            </button>
            <button
              type="button"
              onClick={() => toggleSort('modified')}
              className="w-32 shrink-0 text-left hover:text-gray-700 hidden sm:block"
            >
              Modified{arrow('modified')}
            </button>
            <div className="w-8 shrink-0" />
          </div>

          <ul className="divide-y divide-gray-200">
            {sortedItems.map((item) => {
              const status = item.statusId
                ? statusById.get(item.statusId)
                : undefined;
              return (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {item.object === 'folder' && <FolderIcon />}
                    {item.object === 'file' && <FileIcon />}
                    {item.object === 'link' && <LinkIcon />}
                    {item.object === 'folder' ? (
                      <button
                        type="button"
                        onClick={() => navigate(item.path)}
                        className="font-medium text-gray-900 min-w-0 truncate text-left hover:underline"
                      >
                        {item.name}
                      </button>
                    ) : (
                      <span className="font-medium text-gray-900 min-w-0 truncate">
                        {item.name}
                      </span>
                    )}
                  </div>

                  <div className="w-52 shrink-0">
                    {item.object === 'folder' &&
                      (isInternal ? (
                        <div className="flex items-center gap-2">
                          <StatusDot color={status?.color ?? UNSET_COLOR} />
                          <select
                            className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white disabled:opacity-50 min-w-0"
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
                  </div>

                  <div className="w-32 shrink-0 hidden sm:block text-sm text-gray-500">
                    {formatDate(item.updatedAt)}
                  </div>

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
                      download={item.name}
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
                  {item.object === 'folder' && (
                    <button
                      type="button"
                      className={menuItemClass}
                      onClick={() => {
                        setOpenMenuId(null);
                        openHistory(item);
                      }}
                    >
                      Status history
                    </button>
                  )}
                  {item.object === 'folder' && currentPath === '' && (
                    <button
                      type="button"
                      className={menuItemClass}
                      onClick={() => {
                        setOpenMenuId(null);
                        setConfirmArchive(item);
                      }}
                    >
                      Archive
                    </button>
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
        </div>
      )}

      {historyItem && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setHistoryItem(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <Heading size="lg">Status history</Heading>
              <button
                type="button"
                onClick={() => setHistoryItem(null)}
                className="text-gray-500 hover:bg-gray-100 rounded px-2 leading-none"
              >
                &#10005;
              </button>
            </div>
            <Body size="sm" className="text-gray-500 mb-4 truncate">
              {historyItem.name}
            </Body>
            {historyLoading ? (
              <Body size="sm" className="text-gray-500">
                Loading…
              </Body>
            ) : !historyEntries || historyEntries.length === 0 ? (
              <Body size="sm" className="text-gray-500">
                No status changes yet.
              </Body>
            ) : (
              <ul className="space-y-3">
                {historyEntries.map((e, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1">
                      <StatusDot color={e.statusColor ?? UNSET_COLOR} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">{e.statusLabel}</div>
                      <div className="text-xs text-gray-500">
                        {e.changedByName ? `${e.changedByName} · ` : ''}
                        {new Date(e.changedAt).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {confirmArchive && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setConfirmArchive(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <Heading size="lg">Archive job?</Heading>
            <Body size="sm" className="text-gray-600 mt-2">
              &ldquo;{confirmArchive.name}&rdquo; will be hidden from the jobs
              list for everyone. You can unarchive it anytime from the Archived
              list.
            </Body>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmArchive(null)}
                className="text-sm px-3 py-1 rounded-md text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const it = confirmArchive;
                  setConfirmArchive(null);
                  await setArchived(it, true);
                }}
                className="text-sm px-3 py-1 rounded-md bg-gray-900 text-white disabled:opacity-40"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}

      {showArchived && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowArchived(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <Heading size="lg">Archived jobs</Heading>
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                className="text-gray-500 hover:bg-gray-100 rounded px-2 leading-none"
              >
                &#10005;
              </button>
            </div>
            {archivedFolders.length === 0 ? (
              <Body size="sm" className="text-gray-500">
                No archived jobs.
              </Body>
            ) : (
              <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg">
                {archivedFolders.map((folder) => {
                  const status = folder.statusId
                    ? statusById.get(folder.statusId)
                    : undefined;
                  return (
                    <li
                      key={folder.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <FolderIcon />
                      <span className="font-medium text-gray-900 flex-1 min-w-0 truncate">
                        {folder.name}
                      </span>
                      <StatusBadge status={status} />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setArchived(folder, false)}
                        className="text-sm px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                      >
                        Unarchive
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
