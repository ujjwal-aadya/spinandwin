import { db } from '@/lib/db';
import { requireAdmin, ROLES } from '@/lib/session';
import { collectSchema } from '@/lib/validation';
import { audit } from '@/lib/audit';
import { ok, fail, ipHash, readJson, sameOriginOk, serverError, validationError, ERRORS } from '@/lib/http';
import { ZodError } from 'zod';

export const dynamic = 'force-dynamic';

/** Idempotent: a second attempt reports ALREADY_COLLECTED instead of double-issuing. */
export async function POST(req: Request) {
  try {
    if (!sameOriginOk(req)) return fail('Request rejected.', 403, 'CSRF');
    const admin = await requireAdmin(ROLES.all);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const input = collectSchema.parse(await readJson(req));
    const { data, error } = await db().rpc('collect_prize', {
      p_winner_id: input.winnerId, p_admin_id: admin.id,
      p_notes: input.notes || null, p_ip_hash: ipHash(req),
    });
    if (error) throw new Error(error.message);

    const result = data as { ok: boolean; reason?: string; collected_at?: string };
    if (!result.ok) {
      await audit({ adminId: admin.id, action: 'COLLECTION_REJECTED', entity: 'winner',
        entityId: input.winnerId, ipHash: ipHash(req), metadata: { reason: result.reason } });
      return fail('This prize has already been collected.', 409, 'ALREADY_COLLECTED');
    }

    return ok({ collected: true, collectedAt: result.collected_at, by: admin.fullName });
  } catch (error) {
    if (error instanceof ZodError) return validationError(error);
    return serverError('admin-collect', error);
  }
}
