import { assemblyApi } from '@assembly-js/node-sdk';
import { need } from '@/utils/need';

// File-management actions. Upload/New Folder/Delete are available to both
// clients and internal users (per project decision). Everyone is scoped to a
// channel server-side: clients to their own company, internal to ?companyId=.
export async function POST(request: Request) {
  const apiKey = need<string>(
    process.env.ASSEMBLY_API_KEY,
    'ASSEMBLY_API_KEY is required',
  );

  const body = (await request.json()) as {
    token?: string;
    companyId?: string;
    action?: 'upload' | 'newFolder' | 'delete';
    path?: string; // parent folder path (newFolder/upload) or item path (delete)
    name?: string; // new folder/file name
    fileId?: string; // item id (for delete)
    object?: 'folder' | 'file' | 'link';
  };

  const assembly = await assemblyApi({ apiKey, token: body.token });
  const payload = await assembly.getTokenPayload?.();

  const companyId = payload?.internalUserId ? body.companyId : payload?.companyId;
  if (!companyId) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const channels = await assembly.listFileChannels({
    membershipType: 'company',
    companyId,
  });
  const channelId = channels.data?.[0]?.id;
  if (!channelId)
    return Response.json({ error: 'No file channel' }, { status: 400 });

  try {
    switch (body.action) {
      case 'upload': {
        // Step 1 of the upload: create a PENDING file and return its uploadUrl.
        // The browser then PUTs the bytes straight to that URL (valid 15 min).
        const name = (body.name ?? '').trim();
        if (!name)
          return Response.json({ error: 'Name is required' }, { status: 400 });
        const parent = body.path ?? '';
        const fullPath = parent ? `${parent}/${name}` : name;
        const res = await assembly.createFile({
          fileType: 'file',
          requestBody: { path: fullPath, channelId },
        });
        // uploadUrl is returned by the API but not in the SDK's typed shape.
        const uploadUrl = (res as { uploadUrl?: string }).uploadUrl;
        if (!uploadUrl)
          return Response.json(
            { error: 'No upload URL returned' },
            { status: 500 },
          );
        return Response.json({ uploadUrl });
      }

      case 'newFolder': {
        const name = (body.name ?? '').trim();
        if (!name)
          return Response.json({ error: 'Name is required' }, { status: 400 });
        if (name.includes('/'))
          return Response.json(
            { error: 'Name cannot contain "/"' },
            { status: 400 },
          );
        const parent = body.path ?? '';
        const fullPath = parent ? `${parent}/${name}` : name;
        await assembly.createFile({
          fileType: 'folder',
          requestBody: { path: fullPath, channelId },
        });
        return Response.json({ ok: true });
      }

      case 'delete': {
        if (!body.fileId)
          return Response.json({ error: 'fileId is required' }, { status: 400 });

        // Folders must be emptied first (delete is not recursive server-side).
        if (body.object === 'folder' && body.path) {
          const listing = await assembly.listFiles({ channelId });
          const prefix = `${body.path}/`;
          const descendants = (listing.data ?? []).filter(
            (f) => typeof f.path === 'string' && f.path.startsWith(prefix),
          );
          // Deepest paths first so children go before their parents.
          descendants.sort(
            (a, b) =>
              (b.path as string).split('/').length -
              (a.path as string).split('/').length,
          );
          for (const d of descendants) {
            if (d.id) await assembly.deleteFile({ id: d.id });
          }
        }
        await assembly.deleteFile({ id: body.fileId });
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Action failed' },
      { status: 500 },
    );
  }
}
