import { assemblyClient } from '@/utils/assembly';
import {
  createStatus,
  updateStatus,
  deleteStatus,
  setStatusOrder,
} from '@/utils/db';

const HEX = /^#[0-9a-fA-F]{6}$/;

// Manage status categories. Internal users only — role is derived server-side
// from the token, never trusted from the request body.
export async function POST(request: Request) {
  const body = (await request.json()) as {
    token?: string;
    action?: 'create' | 'update' | 'delete' | 'reorder';
    kind?: 'internal' | 'client'; // which list (create only); update/delete/reorder are by id
    id?: string;
    label?: string;
    color?: string;
    orderedIds?: string[];
  };

  const assembly = await assemblyClient(body.token);
  const payload = await assembly.getTokenPayload?.();
  if (!payload?.internalUserId) {
    return Response.json(
      { error: 'Only internal users can manage statuses' },
      { status: 403 },
    );
  }

  const label = (body.label ?? '').trim();
  const color = body.color ?? '';

  try {
    switch (body.action) {
      case 'create':
        if (!label)
          return Response.json({ error: 'Label is required' }, { status: 400 });
        if (!HEX.test(color))
          return Response.json(
            { error: 'Color must be a hex value like #3B82F6' },
            { status: 400 },
          );
        await createStatus(label, color, body.kind === 'client' ? 'client' : 'internal');
        break;

      case 'update':
        if (!body.id)
          return Response.json({ error: 'id is required' }, { status: 400 });
        if (!label)
          return Response.json({ error: 'Label is required' }, { status: 400 });
        if (!HEX.test(color))
          return Response.json(
            { error: 'Color must be a hex value like #3B82F6' },
            { status: 400 },
          );
        await updateStatus(body.id, label, color);
        break;

      case 'delete':
        if (!body.id)
          return Response.json({ error: 'id is required' }, { status: 400 });
        await deleteStatus(body.id);
        break;

      case 'reorder':
        if (!Array.isArray(body.orderedIds))
          return Response.json(
            { error: 'orderedIds is required' },
            { status: 400 },
          );
        await setStatusOrder(body.orderedIds);
        break;

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Failed to update statuses' },
      { status: 500 },
    );
  }
}
