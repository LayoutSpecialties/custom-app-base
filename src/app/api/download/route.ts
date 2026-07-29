import { assemblyClient } from '@/utils/assembly';

// Redirects to a short-lived download URL for a file. Clients are scoped to
// their own company channel; internal users may download from any channel.
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
  return Response.redirect(file.downloadUrl, 302);
}
