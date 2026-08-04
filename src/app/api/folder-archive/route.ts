import { assemblyClient } from '@/utils/assembly';
import { setArchived } from '@/utils/db';

// Archive or unarchive a folder (shared flag; affects both internal and client
// views). Clients are scoped to their own company channel; internal users pass
// the channel they're viewing.
export async function POST(request: Request) {
  const { token, channelId, folderId, archived } = (await request.json()) as {
    token?: string;
    channelId?: string;
    folderId?: string;
    archived?: boolean;
  };
  if (!channelId || !folderId) {
    return Response.json(
      { error: 'channelId and folderId are required' },
      { status: 400 },
    );
  }

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();

  // Scope check for clients: the channel must be their own company channel.
  if (!payload?.internalUserId) {
    if (!payload?.companyId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const channels = await assembly.listFileChannels({
      membershipType: 'company',
      companyId: payload.companyId,
    });
    const allowed = channels.data?.[0]?.id;
    if (!allowed || allowed !== channelId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const who = payload?.internalUserId ?? payload?.clientId ?? null;
  try {
    await setArchived(channelId, folderId, !!archived, who ?? undefined);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to update archive' },
      { status: 500 },
    );
  }
}
