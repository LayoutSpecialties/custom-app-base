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

// Client-set urgency categories, shown on files in a job's 00_Surveys folder.
// A separate managed list (kind='client'); seeded on a fresh DB, editable by
// internal users under Manage statuses.
export const DEFAULT_CLIENT_CATEGORIES: Omit<StatusDef, 'id'>[] = [
  { label: 'No rush', color: '#9CA3AF', sortOrder: 0 }, // gray
  { label: 'Soon', color: '#F59E0B', sortOrder: 1 }, // amber
  { label: 'ASAP', color: '#EF4444', sortOrder: 2 }, // red
];

// The exact folder name (created per job by the automation) whose files carry a
// client category.
export const SURVEY_FOLDER = '00_Surveys';

// Internal folder statuses appear ONLY on top-level job folders and on the
// direct subfolders of these DWG folders — nowhere else.
export const DWG_FOLDERS = [
  '01_AutoCAD DWGs',
  '01_Panel DWGs',
  '02_Architectural DWGs',
];

// Job attributes a client sets on a top-level job folder — both managed lists,
// editable under Manage statuses. Job type = pick one; includes = pick any.
export const DEFAULT_JOB_TYPES: Omit<StatusDef, 'id'>[] = [
  { label: 'Stick', color: '#6B7280', sortOrder: 0 },
  { label: 'Panel', color: '#6B7280', sortOrder: 1 },
];
export const DEFAULT_INCLUDES: Omit<StatusDef, 'id'>[] = [
  { label: 'Walls', color: '#6B7280', sortOrder: 0 },
  { label: 'HDs', color: '#6B7280', sortOrder: 1 },
  { label: 'Posts', color: '#6B7280', sortOrder: 2 },
  { label: 'ABs', color: '#6B7280', sortOrder: 3 },
  { label: 'Steel', color: '#6B7280', sortOrder: 4 },
];

// The standard subfolder tree auto-created inside a new job. Editable in the app
// (Manage statuses → Job folder template). Paths are relative to the job root.
// Floors are NOT here — they're chosen per job and created inside FLOOR_PARENT.
export const DEFAULT_JOB_TEMPLATE: string[] = [
  '01_To Layout Specialties',
  '01_To Layout Specialties/00_Surveys',
  '01_To Layout Specialties/01_AutoCAD DWGs',
  '01_To Layout Specialties/02_PDF Plans',
  '01_To Layout Specialties/03_Misc Data',
  '02_From Layout Specialties',
  '02_From Layout Specialties/01_Layout Files',
  '02_From Layout Specialties/02_Exhibits',
  '02_From Layout Specialties/03_Out of Date',
];

// Floors are created inside this folder (relative to the job root).
export const FLOOR_PARENT = '01_To Layout Specialties/01_AutoCAD DWGs';

// Floor options offered when creating a new job (Basement is just an option).
export const FLOOR_OPTIONS: string[] = [
  '00_Basement',
  '01_First Floor',
  '02_Second Floor',
  '03_Third Floor',
  '04_Fourth Floor',
  '05_Fifth Floor',
  '06_Sixth Floor',
  '07_Seventh Floor',
  '08_Eighth Floor',
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
