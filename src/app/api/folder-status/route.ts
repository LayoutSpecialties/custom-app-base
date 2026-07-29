import { assemblyClient } from '@/utils/assembly';
import { setFolderStatus } from '@/utils/db';

// Assign (or clear) a folder's status. Internal users only — the role is
// derived server-side from the token, never trusted from the request body.
export async function POST(request: Request) {
  const { token, channelId, folderId, statusId } = (await request.json()) as {
    token?: string;
    channelId?: string;
    folderId?: string;
    statusId?: string | null;
  };

  if (!channelId || !folderId) {
    return Response.json(
      { error: 'channelId and folderId are required' },
      { status: 400 },
    );
  }

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();
  if (!payload?.internalUserId) {
    return Response.json(
      { error: 'Only internal users can change status' },
      { status: 403 },
    );
  }

  try {
    await setFolderStatus(
      channelId,
      folderId,
      statusId ?? null,
      payload.internalUserId,
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to update status' },
      { status: 500 },
    );
  }
}
