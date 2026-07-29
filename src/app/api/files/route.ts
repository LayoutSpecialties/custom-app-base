import { assemblyClient } from '@/utils/assembly';
import { sendUploadNotification } from '@/utils/email';

// File-management actions. Upload/New Folder/Delete are available to both
// clients and internal users (per project decision). Everyone is scoped to a
// channel server-side: clients to their own company, internal to ?companyId=.
export async function POST(request: Request) {
  const body = (await request.json()) as {
    token?: string;
    companyId?: string;
    action?:
      | 'upload'
      | 'newFolder'
      | 'ensureFolders'
      | 'delete'
      | 'notifyUpload';
    path?: string; // parent folder path (newFolder/upload) or item path (delete)
    name?: string; // new folder/file name
    paths?: string[]; // folder paths to ensure (for ensureFolders)
    fileNames?: string[]; // uploaded file names (for notifyUpload)
    fileId?: string; // item id (for delete)
    object?: 'folder' | 'file' | 'link';
  };

  const assembly = await assemblyClient(body.token);
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

      case 'ensureFolders': {
        // Create each folder in order (shallowest first). Ignore per-folder
        // errors so already-existing folders don't abort a folder upload.
        for (const p of body.paths ?? []) {
          if (!p) continue;
          try {
            await assembly.createFile({
              fileType: 'folder',
              requestBody: { path: p, channelId },
            });
          } catch {
            /* folder likely already exists */
          }
        }
        return Response.json({ ok: true });
      }

      case 'notifyUpload': {
        // Email the internal team when a CLIENT uploads. Internal uploads are
        // not notified. Never fails the request if email is unconfigured.
        if (payload?.internalUserId) return Response.json({ ok: true });
        let companyName: string | undefined;
        try {
          if (payload?.companyId) {
            const c = await assembly.retrieveCompany({ id: payload.companyId });
            companyName = c.name;
          }
        } catch {
          /* ignore */
        }
        const fileNames = Array.isArray(body.fileNames)
          ? body.fileNames.slice(0, 50).map(String)
          : [];
        await sendUploadNotification({ companyName, fileNames });
        return Response.json({ ok: true });
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
