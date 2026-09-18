import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { requireAdmin, ROLES } from '@/lib/session';
import { audit } from '@/lib/audit';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import { ZodError, z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');
    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');
    return ok({ event });
  } catch (error) {
    return serverError('admin-event-get', error);
  }
}

const ts = z.string().datetime({ offset: true }).nullable();

const schema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  venue: z.string().trim().max(160).nullable().optional(),
  registrationStart: ts.optional(),
  registrationEnd: ts.optional(),
  spinStart: ts.optional(),
  spinEnd: ts.optional(),
  registrationEnabled: z.boolean().optional(),
  spinEnabled: z.boolean().optional(),
  maxParticipants: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(3).max(200),
});

/** Emergency controls live here: pause registration, pause spinning, change windows. */
export async function PATCH(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const input = schema.parse(await readJson(req));
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.venue !== undefined) patch.venue = input.venue;
    if (input.registrationStart !== undefined) patch.registration_start = input.registrationStart;
    if (input.registrationEnd !== undefined) patch.registration_end = input.registrationEnd;
    if (input.spinStart !== undefined) patch.spin_start = input.spinStart;
    if (input.spinEnd !== undefined) patch.spin_end = input.spinEnd;
    if (input.registrationEnabled !== undefined) patch.registration_enabled = input.registrationEnabled;
    if (input.spinEnabled !== undefined) patch.spin_enabled = input.spinEnabled;
    if (input.maxParticipants !== undefined) patch.max_participants = input.maxParticipants;
    if (Object.keys(patch).length === 0) return fail('Nothing to update.', 400, 'NO_CHANGES');

    const { error } = await db().from('events').update(patch).eq('id', event.id);
    if (error) throw new Error(error.message);

    await audit({ eventId: event.id, adminId: admin.id, action: 'EVENT_CONFIG_CHANGED', entity: 'event',
      entityId: event.id, ipHash: ipHash(req), metadata: { ...patch, reason: input.reason } });

    return ok({ updated: true });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('admin-event-patch', error);
  }
}
