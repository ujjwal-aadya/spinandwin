import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { requireAdmin, ROLES } from '@/lib/session';
import { ok, fail, serverError, ERRORS } from '@/lib/http';
import type { EventStats, PrizeInventoryRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const admin = await requireAdmin(ROLES.all);
    if (!admin) return fail(ERRORS.FORBIDDEN, 401, 'NO_SESSION');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const [{ data: stats }, { data: inventory }] = await Promise.all([
      db().rpc('event_stats', { p_event_id: event.id }),
      db().from('prize_inventory').select('*').eq('event_id', event.id)
        .order('display_order', { ascending: true }).returns<PrizeInventoryRow[]>(),
    ]);

    const s = stats as EventStats;
    const collectionRate = s.winners > 0 ? Math.round((s.collected / s.winners) * 100) : 0;

    return ok({
      event: { id: event.id, name: event.name, code: event.code,
               registrationEnabled: event.registration_enabled, spinEnabled: event.spin_enabled },
      stats: { ...s, collectionRate },
      inventory: inventory ?? [],
      role: admin.role,
    });
  } catch (error) {
    return serverError('admin-stats', error);
  }
}
