import { assemblyApi } from '@assembly-js/node-sdk';
import { need } from '@/utils/need';
import { getFolderStatusMap, listStatuses } from '@/utils/db';
import type { StatusDef } from '@/utils/status';

export interface FileItem {
  id: string;
  name: string;
  object: 'folder' | 'file' | 'link';
  path: string;
  statusId: string | null; // folders only
  linkUrl?: string; // links only
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
}

// Internal users may view any company; we cap the picker list for now.
const COMPANY_LIMIT = 100;

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
  const apiKey = need<string>(
    process.env.ASSEMBLY_API_KEY,
    'ASSEMBLY_API_KEY is required',
  );
  const assembly = await assemblyApi({ apiKey, token });
  const payload = await assembly.getTokenPayload?.();
  const isInternal = !!payload?.internalUserId;

  const statuses = await listStatuses();
  const empty = { statuses, currentPath: '', breadcrumb: [], items: [] };

  let companyId: string | undefined;
  let companyName: string | undefined;
  let companies: CompanyOption[] | undefined;

  if (isInternal) {
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

  if (!companyName) {
    const company = await assembly.retrieveCompany({ id: companyId });
    companyName = company.name;
  }

  const channels = await assembly.listFileChannels({
    membershipType: 'company',
    companyId,
  });
  const channelId = channels.data?.[0]?.id;
  if (!channelId)
    return { isInternal, companyId, companyName, companies, ...empty };

  // listFiles returns a flat, recursive list for the whole channel. Take the
  // direct children of currentPath (paths whose remainder has no '/').
  const files = await assembly.listFiles({ channelId });
  const statusMap = await getFolderStatusMap(channelId);
  const prefix = currentPath ? `${currentPath}/` : '';

  const items: FileItem[] = (files.data ?? [])
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
      };
    })
    .sort((a, b) => {
      if (a.object === 'folder' && b.object !== 'folder') return -1;
      if (a.object !== 'folder' && b.object === 'folder') return 1;
      return a.name.localeCompare(b.name);
    });

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
    items,
  };
}
