import { assemblyClient } from '@/utils/assembly';
import { setJobMeta } from '@/utils/db';

// Set a top-level job folder's job type + includes. Editable by the client who
// owns the job AND by internal users (who can override). Scoped to the acting
// user's channel; only top-level folders (no '/' in the path) are allowed.
export async function POST(request: Request) {
  const { token, companyId, folderId, path, jobTypeId, includeIds } =
    (await request.json()) as {
      token?: string;
      companyId?: string;
      folderId?: string;
      path?: string;
      jobTypeId?: string | null;
      includeIds?: string[];
    };

  if (!folderId || !path || path.includes('/')) {
    return Response.json(
      { error: 'A top-level job folder is required' },
      { status: 400 },
    );
  }

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();
  const scopedCompanyId = payload?.internalUserId ? companyId : payload?.companyId;
  if (!scopedCompanyId)
    return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const channels = await assembly.listFileChannels({
      membershipType: 'company',
      companyId: scopedCompanyId,
    });
    const channelId = channels.data?.[0]?.id;
    if (!channelId)
      return Response.json({ error: 'No file channel' }, { status: 400 });

    const ids = Array.isArray(includeIds)
      ? includeIds.filter((x) => typeof x === 'string')
      : [];
    await setJobMeta(
      channelId,
      folderId,
      jobTypeId || null,
      ids,
      payload?.internalUserId ?? payload?.clientId,
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to save job details' },
      { status: 500 },
    );
  }
}
