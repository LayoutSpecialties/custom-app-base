'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Body, Heading } from '@assembly-js/design-system';
import type { StatusDef } from '@/utils/status';

async function postStatus(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/statuses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Failed (${res.status})`);
  }
}

export function ManageStatuses({
  statuses,
  token,
}: {
  statuses: StatusDef[];
  token?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  function move(id: string, dir: 'up' | 'down') {
    const ids = statuses.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => postStatus({ token, action: 'reorder', orderedIds: ids }));
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm border border-gray-300 rounded-md px-3 py-1 bg-white text-gray-700 hover:bg-gray-50"
      >
        Manage statuses
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-[30rem] max-w-[92vw] z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-4">
            <div className="mb-2">
              <Heading size="lg">Manage statuses</Heading>
              <Body size="sm" className="text-gray-500 mt-1">
                Rename, recolor, reorder, add, or remove the statuses your team
                can assign to folders.
              </Body>
            </div>

            {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

            <div className="divide-y divide-gray-100">
              {statuses.map((s, i) => (
                <EditRow
                  key={s.id}
                  status={s}
                  busy={busy}
                  canMoveUp={i > 0}
                  canMoveDown={i < statuses.length - 1}
                  onSave={(label, color) =>
                    run(() =>
                      postStatus({
                        token,
                        action: 'update',
                        id: s.id,
                        label,
                        color,
                      }),
                    )
                  }
                  onDelete={() =>
                    run(() => postStatus({ token, action: 'delete', id: s.id }))
                  }
                  onMoveUp={() => move(s.id, 'up')}
                  onMoveDown={() => move(s.id, 'down')}
                />
              ))}
            </div>

            <AddRow
              busy={busy}
              onAdd={(label, color) =>
                run(() => postStatus({ token, action: 'create', label, color }))
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function EditRow({
  status,
  busy,
  canMoveUp,
  canMoveDown,
  onSave,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  status: StatusDef;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSave: (label: string, color: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [label, setLabel] = useState(status.label);
  const [color, setColor] = useState(status.color);
  const dirty = label !== status.label || color !== status.color;

  return (
    <div className="flex items-center gap-2 py-2">
      <input
        type="color"
        value={color}
        disabled={busy}
        onChange={(e) => setColor(e.target.value)}
        aria-label={`${status.label} color`}
        className="w-8 h-8 p-0 border border-gray-300 rounded cursor-pointer bg-white"
      />
      <input
        type="text"
        value={label}
        disabled={busy}
        onChange={(e) => setLabel(e.target.value)}
        aria-label={`${status.label} name`}
        className="flex-1 min-w-0 text-sm border border-gray-300 rounded-md px-2 py-1"
      />
      <button
        type="button"
        title="Move up"
        disabled={busy || !canMoveUp}
        onClick={onMoveUp}
        className="px-2 py-1 text-gray-600 disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        title="Move down"
        disabled={busy || !canMoveDown}
        onClick={onMoveDown}
        className="px-2 py-1 text-gray-600 disabled:opacity-30"
      >
        ↓
      </button>
      <button
        type="button"
        disabled={busy || !dirty || !label.trim()}
        onClick={() => onSave(label.trim(), color)}
        className="text-sm px-2 py-1 rounded-md bg-gray-900 text-white disabled:opacity-30"
      >
        Save
      </button>
      <button
        type="button"
        title="Delete status"
        disabled={busy}
        onClick={() => {
          if (
            confirm(
              `Delete "${status.label}"? Folders using it will show "No status".`,
            )
          )
            onDelete();
        }}
        className="text-sm px-2 py-1 rounded-md text-red-600 disabled:opacity-30"
      >
        Delete
      </button>
    </div>
  );
}

function AddRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (label: string, color: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#6B7280');

  return (
    <div className="flex items-center gap-2 pt-4 mt-2 border-t border-gray-200">
      <input
        type="color"
        value={color}
        disabled={busy}
        onChange={(e) => setColor(e.target.value)}
        aria-label="New status color"
        className="w-8 h-8 p-0 border border-gray-300 rounded cursor-pointer bg-white"
      />
      <input
        type="text"
        value={label}
        disabled={busy}
        placeholder="New status name"
        onChange={(e) => setLabel(e.target.value)}
        aria-label="New status name"
        className="flex-1 min-w-0 text-sm border border-gray-300 rounded-md px-2 py-1"
      />
      <button
        type="button"
        disabled={busy || !label.trim()}
        onClick={() => {
          onAdd(label.trim(), color);
          setLabel('');
        }}
        className="text-sm px-3 py-1 rounded-md bg-gray-900 text-white disabled:opacity-30"
      >
        Add
      </button>
    </div>
  );
}
