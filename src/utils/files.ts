import { assemblyClient } from '@/utils/assembly';
import { getArchivedSet, getFolderStatusMap, listStatuses } from '@/utils/db';
import { withRateLimitRetry } from '@/utils/retry';
import type { StatusDef } from '@/utils/status';

export interface FileItem {
  id: string;
  name: string;
  object: 'folder' | 'file' | 'link';
  path: string;
  statusId: string | null; // folders only
  linkUrl?: string; // links only
  updatedAt?: string;
  creatorId?: string;
  creatorName?: string; // resolved display name (all viewers)
}

export interface Crumb {
  name: string;
  path: string;
}

export interface CompanyOption {
  id: string;
  name: string;
}

export interface FolderView {
  isInternal: boolean;
  companyId?: string;
  companyName?: string;
  companies?: CompanyOption[]; // internal picker options (undefined for clients)
  channelId?: string;
  statuses: StatusDef[];
  currentPath: string;
  breadcrumb: Crumb[];
  items: FileItem[];
  archivedFolders: FileItem[]; // archived top-level jobs (root view only)
}

// Internal users may view any company; we cap the picker list for now.
const COMPANY_LIMIT = 100;

// Cache the (single-workspace) company list briefly so internal navigations
// don't re-page the whole list on every load. New companies appear within the
// TTL. Lives per warm serverless instance.
let companiesCache: { at: number; list: CompanyOption[] } | null = null;
const COMPANIES_TTL_MS = 60_000;

type AssemblySdk = Awaited<ReturnType<typeof assemblyClient>>;

export interface RawFile {
  id?: string;
  object?: string;
  path?: string;
  name?: string;
  linkUrl?: string;
  updatedAt?: string;
  creatorId?: string;
}

// Resolve a creator id (an internal teammate or a client) to a display name.
// Cached across requests so the 20s auto-refresh doesn't re-resolve every load.
const creatorCache = new Map<string, { at: number; name: string }>();
const CREATOR_TTL_MS = 5 * 60_000;

async function resolveCreatorName(
  assembly: AssemblySdk,
  id: string,
): Promise<string> {
  const hit = creatorCache.get(id);
  if (hit && Date.now() - hit.at < CREATOR_TTL_MS) return hit.name;
  const nameOf = (u: {
    givenName?: string;
    familyName?: string;
    email?: string;
  }) => [u.givenName, u.familyName].filter(Boolean).join(' ') || u.email || '';
  let name = '';
  try {
    name = nameOf(
      await withRateLimitRetry(() => assembly.retrieveInternalUser({ id })),
    );
  } catch {
    try {
      name = nameOf(
        await withRateLimitRetry(() => assembly.retrieveClient({ id })),
      );
    } catch {
      /* neither an internal user nor a client we can read */
    }
  }
  if (name) creatorCache.set(id, { at: Date.now(), name });
  return name || 'Unknown';
}

// Resolve many creator ids with a small concurrency cap (gentle on the API).
async function resolveCreatorNames(
  assembly: AssemblySdk,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      map.set(id, await resolveCreatorName(assembly, id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, worker));
  return map;
}

// Page through EVERY file in a channel (optionally under `path`). listFiles is
// paginated; fetching a single page would miss files in large channels — which
// broke recursive delete (folder "not empty") and could hide files in listings.
export async function listAllFiles(
  assembly: AssemblySdk,
  channelId: string,
  path?: string,
): Promise<RawFile[]> {
  const all: RawFile[] = [];
  let nextToken: string | undefined;
  let guard = 0;
  do {
    const res = await assembly.listFiles({ channelId, path, nextToken });
    if (res.data) all.push(...(res.data as RawFile[]));
    nextToken = (res as { nextToken?: string }).nextToken;
  } while (nextToken && ++guard < 100);
  return all;
}

/**
 * Resolves the contents of one folder for the current viewer.
 *
 * - Client: hard-scoped to the company in their token. `selectedCompanyId` is
 *   ignored, so a client can never view another company's files.
 * - Internal user: lists companies and views `selectedCompanyId` if it's a real
 *   company, otherwise the first one.
 *
 * `currentPath` is the folder being viewed ('' = channel root).
 */
export async function getFolderView(
  token: string | undefined,
  selectedCompanyId?: string,
  currentPath: string = '',
): Promise<FolderView> {
  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();
  const isInternal = !!payload?.internalUserId;

  const statuses = await listStatuses();
  const empty = {
    statuses,
    currentPath: '',
    breadcrumb: [],
    items: [],
    archivedFolders: [],
  };

  let companyId: string | undefined;
  let companyName: string | undefined;
  let companies: CompanyOption[] | undefined;

  if (isInternal) {
    if (companiesCache && Date.now() - companiesCache.at < COMPANIES_TTL_MS) {
      companies = companiesCache.list;
    } else {
      // Page through all non-placeholder companies (placeholder companies have
      // no name and would show as blank rows). Native <select> scrolls a long
      // list on its own.
      const raw: { id?: string; name?: string }[] = [];
      let nextToken: string | undefined;
      let guard = 0;
      do {
        const list = await assembly.listCompanies({
          isPlaceholder: false,
          limit: COMPANY_LIMIT,
          nextToken,
        });
        raw.push(...(list.data ?? []));
        nextToken = (list as { nextToken?: string }).nextToken;
      } while (nextToken && ++guard < 20);
      companies = raw
        .map((c) => ({ id: c.id ?? '', name: (c.name ?? '').trim() }))
        .filter((c) => c.id && c.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      companiesCache = { at: Date.now(), list: companies };
    }
    // Prefer an explicit dropdown choice (?companyId=), then the company the
    // app was opened from if Assembly passes one in the token, then the first.
    const known = (id: string | undefined | null): id is string =>
      !!id && companies!.some((c) => c.id === id);
    companyId = known(selectedCompanyId)
      ? selectedCompanyId
      : known(payload?.companyId)
        ? payload?.companyId
        : companies[0]?.id;
    companyName = companies.find((c) => c.id === companyId)?.name;
  } else {
    companyId = payload?.companyId; // client: locked to own company
  }

  if (!companyId) return { isInternal, companies, ...empty };

  // Resolve the company name (clients only) and the file channel in parallel.
  const [company, channels] = await Promise.all([
    companyName
      ? Promise.resolve(null)
      : assembly.retrieveCompany({ id: companyId }),
    assembly.listFileChannels({ membershipType: 'company', companyId }),
  ]);
  if (company) companyName = company.name ?? companyName;

  const channelId = channels.data?.[0]?.id;
  if (!channelId)
    return { isInternal, companyId, companyName, companies, ...empty };

  // Fetch the file list, the status map, and the archived set in parallel.
  // Scope the file list to the current folder's subtree when drilling in (root
  // needs the whole channel to list top-level jobs + compute archived).
  const [files, statusMap, archivedSet] = await Promise.all([
    listAllFiles(assembly, channelId, currentPath || undefined),
    getFolderStatusMap(channelId),
    getArchivedSet(channelId),
  ]);
  const prefix = currentPath ? `${currentPath}/` : '';

  // A folder's "Modified" should reflect the newest change anywhere inside it.
  // One pass over every file/folder in view: attribute each to the top-level
  // entry it lives under (first path segment) and keep the max updatedAt.
  // ISO date strings compare lexicographically = chronologically.
  const folderNewest = new Map<string, string>();
  for (const f of files) {
    if (typeof f.path !== 'string' || !f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length);
    if (!rel) continue;
    const seg = rel.split('/')[0];
    const u = f.updatedAt;
    if (!u) continue;
    const cur = folderNewest.get(seg);
    if (!cur || u > cur) folderNewest.set(seg, u);
  }

  const items: FileItem[] = files
    .filter((f) => typeof f.path === 'string' && f.path.startsWith(prefix))
    .map((f) => ({ f, rel: (f.path as string).slice(prefix.length) }))
    .filter((x) => x.rel.length > 0 && !x.rel.includes('/'))
    .map(({ f, rel }) => {
      const object: FileItem['object'] =
        f.object === 'folder' || f.object === 'link' ? f.object : 'file';
      const id = f.id ?? (f.path as string);
      return {
        id,
        name: rel,
        object,
        path: f.path as string,
        statusId: object === 'folder' ? (statusMap[id] ?? null) : null,
        linkUrl: object === 'link' ? (f.linkUrl ?? undefined) : undefined,
        // Folders show the newest date of anything inside; files show their own.
        updatedAt:
          object === 'folder'
            ? (folderNewest.get(rel) ?? f.updatedAt)
            : f.updatedAt,
        creatorId: f.creatorId,
      };
    })
    .sort((a, b) => {
      if (a.object === 'folder' && b.object !== 'folder') return -1;
      if (a.object !== 'folder' && b.object === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

  // At the root jobs view, split archived top-level folders out of the active
  // list into their own list (for the "Archived" view). Archiving only applies
  // to top-level folders, so nested views are never filtered.
  const archivedFolders: FileItem[] = [];
  const visibleItems: FileItem[] = [];
  for (const it of items) {
    if (currentPath === '' && it.object === 'folder' && archivedSet.has(it.id)) {
      archivedFolders.push(it);
    } else {
      visibleItems.push(it);
    }
  }

  // Resolve creator names for everyone — clients see who uploaded a file too,
  // for accountability. Cached + rate-limit-safe.
  {
    const shown = [...visibleItems, ...archivedFolders];
    const ids = Array.from(
      new Set(shown.map((i) => i.creatorId).filter(Boolean) as string[]),
    );
    if (ids.length) {
      const names = await resolveCreatorNames(assembly, ids);
      for (const it of shown) {
        if (it.creatorId) it.creatorName = names.get(it.creatorId);
      }
    }
  }

  // Breadcrumb: company root, then each path segment.
  const breadcrumb: Crumb[] = [{ name: companyName ?? 'Home', path: '' }];
  let acc = '';
  for (const seg of currentPath ? currentPath.split('/') : []) {
    acc = acc ? `${acc}/${seg}` : seg;
    breadcrumb.push({ name: seg, path: acc });
  }

  return {
    isInternal,
    companyId,
    companyName,
    companies,
    channelId,
    statuses,
    currentPath,
    breadcrumb,
    items: visibleItems,
    archivedFolders,
  };
}
