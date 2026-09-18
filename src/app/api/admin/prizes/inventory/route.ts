import { db } from '@/lib/db';
import { requireAdmin, ROLES } from '@/lib/session';
import { inventoryAdjustSchema } from '@/lib/validation';
import { ok, fail, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

/** Audited inventory change. `confirm: true` is required once an event is live. */
export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const input = inventoryAdjustSchema.parse(await readJson(req));
    const { data, error } = await db().rpc('adjust_inventory', {
      p_prize_id: input.prizeId, p_delta: input.adjustment,
      p_reason: input.reason, p_admin_id: admin.id,
    });

    if (error) {
      if ((error.message ?? '').includes('NEGATIVE_INVENTORY')) {
        return fail('That would take remaining stock below zero.', 400, 'NEGATIVE_INVENTORY');
      }
      if ((error.message ?? '').includes('PRIZE_NOT_FOUND')) return fail(ERRORS.NOT_FOUND, 404, 'NOT_FOUND');
      throw new Error(error.message);
    }

    return ok(data as { previous: number; adjustment: number; new: number });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('admin-inventory', error);
  }
}
