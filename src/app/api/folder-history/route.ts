import { assemblyApi } from '@assembly-js/node-sdk';
import { need } from '@/utils/need';
import { getFolderHistory } from '@/utils/db';

// Returns a folder's status-change history. Internal users only.
export async function POST(request: Request) {
  const apiKey = need<string>(
    process.env.ASSEMBLY_API_KEY,
    'ASSEMBLY_API_KEY is required',
  );

  const { token, channelId, folderId } = (await request.json()) as {
    token?: string;
    channelId?: string;
    folderId?: string;
  };
  if (!channelId || !folderId) {
    return Response.json(
      { error: 'channelId and folderId are required' },
      { status: 400 },
    );
  }

  const assembly = await assemblyApi({ apiKey, token });
  const payload = await assembly.getTokenPayload?.();
  const isInternal = !!payload?.internalUserId;

  // Clients may view history, but only for their own company channel.
  if (!isInternal) {
    if (!payload?.companyId)
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    const channels = await assembly.listFileChannels({
      membershipType: 'company',
      companyId: payload.companyId,
    });
    const allowed = channels.data?.[0]?.id;
    if (!allowed || allowed !== channelId)
      return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const history = await getFolderHistory(channelId, folderId);

  // Resolve changer names for internal viewers only (don't expose staff names
  // to clients). Cached per id.
  const names = new Map<string, string>();
  const entries = [];
  for (const h of history) {
    let changedByName: string | null = null;
    if (isInternal && h.changedBy) {
      if (!names.has(h.changedBy)) {
        let name = 'Internal user';
        try {
          const u = await assembly.retrieveInternalUser({ id: h.changedBy });
          name =
            [u.givenName, u.familyName].filter(Boolean).join(' ') ||
            u.email ||
            'Internal user';
        } catch {
          /* keep fallback */
        }
        names.set(h.changedBy, name);
      }
      changedByName = names.get(h.changedBy) as string;
    }
    entries.push({
      statusLabel: h.statusLabel,
      statusColor: h.statusColor,
      changedByName,
      changedAt: h.changedAt,
    });
  }

  return Response.json({ entries });
}
