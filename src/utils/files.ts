import { assemblyApi } from '@assembly-js/node-sdk';
import { need } from '@/utils/need';
import { getFolderStatusMap, listStatuses } from '@/utils/db';
import type { StatusDef } from '@/utils/status';

export interface FolderItem {
  id: string;
  name: string;
  statusId: string | null;
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
  folders: FolderItem[];
}

// Internal users may view any company; we cap the picker list for now.
const COMPANY_LIMIT = 100;

/**
 * Resolves the folder view for the current viewer.
 *
 * - Client: hard-scoped to the company in their token. `selectedCompanyId` is
 *   ignored, so a client can never view another company's files.
 * - Internal user: lists companies and views `selectedCompanyId` if it's a real
 *   company, otherwise the first one.
 */
export async function getFolderView(
  token: string | undefined,
  selectedCompanyId?: string,
): Promise<FolderView> {
  const apiKey = need<string>(
    process.env.ASSEMBLY_API_KEY,
    'ASSEMBLY_API_KEY is required',
  );
  const assembly = await assemblyApi({ apiKey, token });
  const payload = await assembly.getTokenPayload?.();
  const isInternal = !!payload?.internalUserId;

  const statuses = await listStatuses();

  let companyId: string | undefined;
  let companyName: string | undefined;
  let companies: CompanyOption[] | undefined;

  if (isInternal) {
    const list = await assembly.listCompanies({ limit: COMPANY_LIMIT });
    companies = (list.data ?? [])
      .map((c) => ({ id: c.id ?? '', name: c.name ?? 'Unnamed company' }))
      .filter((c) => c.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    companyId =
      selectedCompanyId && companies.some((c) => c.id === selectedCompanyId)
        ? selectedCompanyId
        : companies[0]?.id;
    companyName = companies.find((c) => c.id === companyId)?.name;
  } else {
    // Client: locked to their own company.
    companyId = payload?.companyId;
  }

  if (!companyId) return { isInternal, companies, statuses, folders: [] };

  if (!companyName) {
    const company = await assembly.retrieveCompany({ id: companyId });
    companyName = company.name;
  }

  // Every company has a `company` file channel holding its shared files.
  const channels = await assembly.listFileChannels({
    membershipType: 'company',
    companyId,
  });
  const channelId = channels.data?.[0]?.id;
  if (!channelId)
    return { isInternal, companyId, companyName, companies, statuses, folders: [] };

  // listFiles returns a flat, recursive list; keep only top-level folders
  // (folders whose path has no '/' separator).
  const files = await assembly.listFiles({ channelId });
  const rawFolders = (files.data ?? [])
    .filter((f) => f.object === 'folder' && !!f.path && !f.path.includes('/'))
    .map((f) => ({
      id: f.id ?? (f.path as string),
      name: (f.path ?? '').split('/').pop() ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const statusMap = await getFolderStatusMap(channelId);
  const folders: FolderItem[] = rawFolders.map((f) => ({
    ...f,
    statusId: statusMap[f.id] ?? null,
  }));

  return {
    isInternal,
    companyId,
    companyName,
    companies,
    channelId,
    statuses,
    folders,
  };
}
