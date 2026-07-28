import { assemblyApi } from '@assembly-js/node-sdk';
import { need } from '@/utils/need';

export interface FolderItem {
  id: string;
  name: string;
}

export interface FolderView {
  companyName?: string;
  channelId?: string;
  folders: FolderItem[];
}

/**
 * Resolves the top-level folders a viewer should see.
 *
 * - Client (token carries companyId): that company's file channel.
 * - Internal user (no companyId in token): falls back to the first company in
 *   the workspace, so we can see real data while testing from the dashboard.
 *   A company picker for internal users comes in a later increment.
 */
export async function getFolderView(
  token: string | undefined,
): Promise<FolderView> {
  const apiKey = need<string>(
    process.env.ASSEMBLY_API_KEY,
    'ASSEMBLY_API_KEY is required',
  );
  const assembly = await assemblyApi({ apiKey, token });
  const payload = await assembly.getTokenPayload?.();

  let companyId = payload?.companyId;
  let companyName: string | undefined;

  if (!companyId) {
    const companies = await assembly.listCompanies({ limit: 1 });
    const first = companies.data?.[0];
    companyId = first?.id;
    companyName = first?.name;
  }

  if (!companyId) return { folders: [] };

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
  if (!channelId) return { companyName, folders: [] };

  // listFiles returns a flat, recursive list; keep only top-level folders
  // (folders whose path has no '/' separator).
  const files = await assembly.listFiles({ channelId });
  const folders: FolderItem[] = (files.data ?? [])
    .filter((f) => f.object === 'folder' && !!f.path && !f.path.includes('/'))
    .map((f) => ({
      id: f.id ?? (f.path as string),
      name: (f.path ?? '').split('/').pop() ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { companyName, channelId, folders };
}
