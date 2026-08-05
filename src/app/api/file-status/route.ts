import { assemblyClient } from '@/utils/assembly';
import { setFileClientStatus } from '@/utils/db';
import { SURVEY_FOLDER } from '@/utils/status';

// Set (or clear) a client category on a survey file. CLIENTS ONLY — the role is
// derived server-side from the token, never trusted from the body. The target
// must be a file inside a 00_Surveys folder in the client's own channel.
export async function POST(request: Request) {
  const { token, fileId, statusId } = (await request.json()) as {
    token?: string;
    fileId?: string;
    statusId?: string | null;
  };

  if (!fileId) {
    return Response.json({ error: 'fileId is required' }, { status: 400 });
  }

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();
  if (payload?.internalUserId || !payload?.clientId) {
    return Response.json(
      { error: 'Only clients can set a category' },
      { status: 403 },
    );
  }
  const companyId = payload.companyId;
  if (!companyId) return Response.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const channels = await assembly.listFileChannels({
      membershipType: 'company',
      companyId,
    });
    const channelId = channels.data?.[0]?.id;
    if (!channelId)
      return Response.json({ error: 'No file channel' }, { status: 400 });

    // Verify the file is really in this client's channel and in a survey folder.
    const file = await assembly.retrieveFile({ id: fileId }).catch(() => null);
    if (!file || file.channelId !== channelId) {
      return Response.json({ error: 'File not found' }, { status: 404 });
    }
    if (!(file.path ?? '').split('/').includes(SURVEY_FOLDER)) {
      return Response.json(
        { error: 'Not a survey file' },
        { status: 400 },
      );
    }

    await setFileClientStatus(
      channelId,
      fileId,
      statusId ?? null,
      payload.clientId,
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to set category' },
      { status: 500 },
    );
  }
}
