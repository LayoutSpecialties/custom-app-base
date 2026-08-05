import { assemblyClient } from '@/utils/assembly';
import { listAllFiles, resolveCreatorName } from '@/utils/files';
import { setFileCreator } from '@/utils/db';
import { sendUploadNotification } from '@/utils/email';
import { withRateLimitRetry } from '@/utils/retry';

// Allow the full Vercel free-plan budget: a folder upload (ensureFolders) or a
// recursive delete can make many Assembly calls in one request, and the 429
// backoff below adds waits — without this the default (~10s) would time out.
export const maxDuration = 60;

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

  // Resolve the acting user's display name once (cached across requests), so we
  // can record who really created each file/folder — Assembly can't tell us,
  // since our writes use the workspace key. Best-effort; never fails a create.
  const actingUserId = payload?.internalUserId ?? payload?.clientId;
  let creatorNamePromise: Promise<string> | null = null;
  const creatorName = () =>
    (creatorNamePromise ??= actingUserId
      ? resolveCreatorName(assembly, actingUserId)
      : Promise.resolve('Unknown'));
  const recordCreator = async (fileId?: string) => {
    if (!fileId) return;
    try {
      await setFileCreator(channelId, fileId, await creatorName());
    } catch {
      /* creator tracking is best-effort */
    }
  };

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
        const res = await withRateLimitRetry(() =>
          assembly.createFile({
            fileType: 'file',
            requestBody: { path: fullPath, channelId },
          }),
        );
        // uploadUrl is returned by the API but not in the SDK's typed shape.
        const uploadUrl = (res as { uploadUrl?: string }).uploadUrl;
        if (!uploadUrl)
          return Response.json(
            { error: 'No upload URL returned' },
            { status: 500 },
          );
        await recordCreator(res.id);
        return Response.json({ uploadUrl });
      }

      case 'ensureFolders': {
        // Create each folder in order (shallowest first). Ignore per-folder
        // errors so already-existing folders don't abort a folder upload — an
        // "already exists" error isn't a rate limit, so withRateLimitRetry
        // re-throws it immediately and the catch swallows it. Only genuine 429s
        // wait+retry; kept to a short bounded backoff so a deep folder tree in a
        // single request can't approach the function timeout.
        for (const p of body.paths ?? []) {
          if (!p) continue;
          try {
            const created = await withRateLimitRetry(
              () =>
                assembly.createFile({
                  fileType: 'folder',
                  requestBody: { path: p, channelId },
                }),
              4,
              400,
            );
            await recordCreator(created.id);
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

        // Also skip uploads by our own people (same email domain as the
        // notification recipients, e.g. staff testing as a client). Domains
        // come from NOTIFY_TO, plus an optional NOTIFY_SKIP_DOMAINS override.
        if (payload?.clientId) {
          try {
            const client = await assembly.retrieveClient({
              id: payload.clientId,
            });
            const domain = (client.email ?? '').toLowerCase().split('@')[1];
            const skip = new Set(
              [
                ...(process.env.NOTIFY_TO ?? '').split(','),
                ...(process.env.NOTIFY_SKIP_DOMAINS ?? '').split(','),
              ]
                .map((s) => s.trim().toLowerCase())
                .map((s) => (s.includes('@') ? s.split('@')[1] : s))
                .filter(Boolean),
            );
            if (domain && skip.has(domain)) {
              return Response.json({ ok: true });
            }
          } catch {
            /* if we can't resolve the email, fall through and notify */
          }
        }

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
        const created = await withRateLimitRetry(() =>
          assembly.createFile({
            fileType: 'folder',
            requestBody: { path: fullPath, channelId },
          }),
        );
        await recordCreator(created.id);
        return Response.json({ ok: true });
      }

      case 'delete': {
        if (!body.fileId)
          return Response.json({ error: 'fileId is required' }, { status: 400 });

        // Folders must be emptied first (delete is not recursive server-side).
        if (body.object === 'folder' && body.path) {
          const prefix = `${body.path}/`;
          const descendants = (
            await listAllFiles(assembly, channelId, body.path)
          ).filter((f) => typeof f.path === 'string' && f.path.startsWith(prefix));
          // Deepest paths first so children go before their parents.
          descendants.sort(
            (a, b) =>
              (b.path as string).split('/').length -
              (a.path as string).split('/').length,
          );
          for (const d of descendants) {
            if (d.id)
              await withRateLimitRetry(() => assembly.deleteFile({ id: d.id! }));
          }
        }
        await withRateLimitRetry(() =>
          assembly.deleteFile({ id: body.fileId! }),
        );
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
