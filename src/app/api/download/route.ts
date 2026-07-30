import { assemblyClient } from '@/utils/assembly';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Streams a file to the browser with a Content-Disposition: attachment header
// so it downloads (Save As) rather than opening inline (which is what a bare
// redirect to storage does for PDFs/images). Clients are scoped to their own
// company channel; internal users may download from any channel.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fileId = url.searchParams.get('fileId');
  const token = url.searchParams.get('token') ?? undefined;
  if (!fileId) return new Response('fileId is required', { status: 400 });

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();

  const file = await assembly.retrieveFile({ id: fileId });

  // Scope check for clients: the file must live in their company channel.
  if (!payload?.internalUserId) {
    if (!payload?.companyId) return new Response('Forbidden', { status: 403 });
    const channels = await assembly.listFileChannels({
      membershipType: 'company',
      companyId: payload.companyId,
    });
    const allowed = channels.data?.[0]?.id;
    if (!allowed || file.channelId !== allowed) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  if (!file.downloadUrl) {
    return new Response('No download URL for this item', { status: 404 });
  }

  const upstream = await fetch(file.downloadUrl);
  if (!upstream.ok || !upstream.body) {
    return new Response('Could not fetch the file', { status: 502 });
  }

  const filename = (file.name ?? file.path?.split('/').pop() ?? 'download').replace(
    /["\\\r\n]/g,
    '',
  );
  const headers: Record<string, string> = {
    'Content-Type':
      upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`,
  };
  const len = upstream.headers.get('content-length');
  if (len) headers['Content-Length'] = len;

  return new Response(upstream.body, { headers });
}
