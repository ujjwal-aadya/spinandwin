import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { requireAdmin, ROLES } from '@/lib/session';
import { prizeSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import type { PrizeInventoryRow } from '@/lib/types';
import { ZodError, z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await requireAdmin(ROLES.all);
    if (!admin) return fail(ERRORS.FORBIDDEN, 401, 'NO_SESSION');
    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const { data } = await db().from('prize_inventory').select('*').eq('event_id', event.id)
      .order('display_order', { ascending: true }).returns<PrizeInventoryRow[]>();
    return ok({ prizes: data ?? [] });
  } catch (error) {
    return serverError('admin-prizes-list', error);
  }
}

export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const input = prizeSchema.parse(await readJson(req));
    const { data, error } = await db().from('prizes').insert({
      event_id: event.id, name: input.name, display_name: input.displayName,
      description: input.description || null, initial_quantity: input.initialQuantity,
      remaining_quantity: input.initialQuantity, weight: input.weight,
      is_active: input.isActive, display_order: input.displayOrder, color: input.color ?? '#0F2742',
    }).select('id').single();

    if (error) {
      if (error.code === '23505') return fail('A prize with that name already exists.', 409, 'DUPLICATE');
      throw new Error(error.message);
    }

    await audit({ eventId: event.id, adminId: admin.id, action: 'PRIZE_CONFIG_CHANGED', entity: 'prize',
      entityId: (data as { id: string }).id, ipHash: ipHash(req),
      metadata: { change: 'created', name: input.name, quantity: input.initialQuantity, weight: input.weight } });

    return ok({ id: (data as { id: string }).id });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('admin-prizes-create', error);
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().trim().min(2).max(40).optional(),
  description: z.string().trim().max(200).optional(),
  weight: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

/** Inventory is deliberately NOT editable here — use /api/admin/prizes/inventory. */
export async function PATCH(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const input = patchSchema.parse(await readJson(req));
    const patch: Record<string, unknown> = {};
    if (input.displayName !== undefined) patch.display_name = input.displayName;
    if (input.description !== undefined) patch.description = input.description;
    if (input.weight !== undefined) patch.weight = input.weight;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.color !== undefined) patch.color = input.color;
    if (Object.keys(patch).length === 0) return fail('Nothing to update.', 400, 'NO_CHANGES');

    const { error } = await db().from('prizes').update(patch)
      .eq('id', input.id).eq('event_id', event.id);
    if (error) throw new Error(error.message);

    await audit({ eventId: event.id, adminId: admin.id, action: 'PRIZE_CONFIG_CHANGED', entity: 'prize',
      entityId: input.id, ipHash: ipHash(req), metadata: { change: 'updated', ...patch } });

    return ok({ updated: true });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('admin-prizes-update', error);
  }
}
