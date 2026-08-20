import archiver from 'archiver';
import { Readable } from 'stream';
import { assemblyClient } from '@/utils/assembly';
import { listAllFiles } from '@/utils/files';

export const runtime = 'nodejs';
export const maxDuration = 60; // seconds (Vercel free-plan cap)

// Streams a single .zip of every selected item: files as-is, folders with their
// full contents. Each selected item keeps its own name at the zip root. Clients
// are scoped to their own channel; internal users pass ?companyId=.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const selectedPaths = url.searchParams
    .getAll('path')
    .filter((p) => p.length > 0);
  const companyIdParam = url.searchParams.get('companyId') ?? undefined;
  const token = url.searchParams.get('token') ?? undefined;

  if (selectedPaths.length === 0)
    return new Response('Nothing selected', { status: 400 });

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

  // One listing of the whole channel, then pick the files belonging to any
  // selected item (the file itself, or anything under a selected folder). Each
  // selected item's name is preserved at the zip root (path relative to its
  // parent).
  const listing = await listAllFiles(assembly, channelId);
  const seen = new Set<string>();
  const chosen: { id: string; name: string }[] = [];
  for (const sel of selectedPaths) {
    const parent = sel.split('/').slice(0, -1).join('/');
    const parentPrefix = parent ? `${parent}/` : '';
    const under = `${sel}/`;
    for (const f of listing) {
      if (f.object !== 'file' || typeof f.path !== 'string' || !f.id) continue;
      if (f.path !== sel && !f.path.startsWith(under)) continue;
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      chosen.push({ id: f.id, name: f.path.slice(parentPrefix.length) });
    }
  }

  // Resolve each file's short-lived download URL (limited concurrency).
  const targets = await mapLimit(chosen, 8, async (c) => {
    const detail = await assembly.retrieveFile({ id: c.id });
    return { name: c.name, url: detail.downloadUrl };
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

  const zipName =
    selectedPaths.length === 1
      ? selectedPaths[0].split('/').pop() || 'files'
      : 'selected';

  return new Response(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}.zip"`,
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
