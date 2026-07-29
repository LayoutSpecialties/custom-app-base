import archiver from 'archiver';
import { Readable } from 'stream';
import { assemblyClient } from '@/utils/assembly';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds (Vercel free-plan cap)

// Streams a .zip of every file under `path` (recursively), preserving the
// folder structure. Clients are scoped to their own company channel; internal
// users pass ?companyId= for the company they're viewing.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const folderPath = url.searchParams.get('path') ?? '';
  const companyIdParam = url.searchParams.get('companyId') ?? undefined;
  const token = url.searchParams.get('token') ?? undefined;

  const assembly = await assemblyClient(token);
  const payload = await assembly.getTokenPayload?.();

  const companyId = payload?.internalUserId ? companyIdParam : payload?.companyId;
  if (!companyId) return new Response('Forbidden', { status: 403 });

  const channels = await assembly.listFileChannels({
    membershipType: 'company',
    companyId,
  });
  const channelId = channels.data?.[0]?.id;
  if (!channelId) return new Response('No files', { status: 404 });

  const prefix = folderPath ? `${folderPath}/` : '';
  const listing = await assembly.listFiles({ channelId });
  const fileEntries = (listing.data ?? []).filter(
    (f) =>
      f.object === 'file' &&
      typeof f.path === 'string' &&
      f.path.startsWith(prefix),
  );

  // Resolve each file's short-lived download URL (limited concurrency).
  const targets = await mapLimit(fileEntries, 8, async (f) => {
    const detail = await assembly.retrieveFile({ id: f.id as string });
    return {
      name: (f.path as string).slice(prefix.length) || (f.name ?? 'file'),
      url: detail.downloadUrl,
    };
  });

  const archive = archiver('zip', { zlib: { level: 1 } });

  (async () => {
    for (const t of targets) {
      if (!t.url) continue;
      const resp = await fetch(t.url);
      if (resp.ok && resp.body) {
        archive.append(Readable.fromWeb(resp.body as never), { name: t.name });
      }
    }
    await archive.finalize();
  })().catch((err) => archive.destroy(err));

  const folderName = folderPath ? folderPath.split('/').pop() || 'files' : 'files';

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folderName}.zip"`,
    },
  });
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
