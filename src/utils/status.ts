// Status categories are DATA, not code: internal users manage them via the
// "Manage Statuses" screen and they live in the `statuses` DB table. This file
// only holds the shared type + the defaults we seed a fresh database with.

export interface StatusDef {
  id: string; // stable slug, e.g. 'in_review'
  label: string;
  color: string; // 6-digit hex, e.g. '#3B82F6'
  sortOrder: number;
}

export const DEFAULT_STATUSES: Omit<StatusDef, 'id'>[] = [
  { label: 'Not Started', color: '#9CA3AF', sortOrder: 0 }, // gray
  { label: 'In Progress', color: '#3B82F6', sortOrder: 1 }, // blue
  { label: 'In Review', color: '#F59E0B', sortOrder: 2 }, // amber
  { label: 'Complete', color: '#22C55E', sortOrder: 3 }, // green
];

// Turn an arbitrary label into a stable id/slug.
export function toStatusId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'status'
  );
}

// Fallback color for a folder with no status set.
export const UNSET_COLOR = '#D1D5DB';
