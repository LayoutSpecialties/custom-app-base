import { assemblyClient } from '@/utils/assembly';
import { setAnnouncement } from '@/utils/db';

const MAX_LENGTH = 1000;

// Set (or clear, with empty text) the announcement banner shown to every client
// company. Internal users only — the role is derived server-side from the
// token, never trusted from the request body.
export async function POST(request: Request) {
  const { token, text } = (await request.json()) as {
    token?: string;
    text?: string;
  };

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();
  if (!payload?.internalUserId) {
    return Response.json(
      { error: 'Only internal users can change the announcement' },
      { status: 403 },
    );
  }

  const value = (typeof text === 'string' ? text : '').trim();
  if (value.length > MAX_LENGTH) {
    return Response.json(
      { error: `Keep the announcement under ${MAX_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    await setAnnouncement(value, payload.internalUserId);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to save announcement' },
      { status: 500 },
    );
  }
}
