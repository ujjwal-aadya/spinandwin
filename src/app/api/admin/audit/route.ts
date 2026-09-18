import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { requireAdmin, ROLES } from '@/lib/session';
import { ok, fail, serverError, ERRORS } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 500);

    let query = db().from('audit_logs')
      .select('id, created_at, action, entity, entity_id, metadata, admin_users(full_name), participants(full_name)')
      .eq('event_id', event.id).order('created_at', { ascending: false }).limit(limit);
    if (action) query = query.eq('action', action.replace(/[^A-Z_]/g, ''));

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const entries = (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string; created_at: string; action: string; entity: string | null; entity_id: string | null;
        metadata: Record<string, unknown>;
        admin_users: { full_name: string } | null; participants: { full_name: string } | null;
      };
      return { id: r.id, at: r.created_at, action: r.action, entity: r.entity, entityId: r.entity_id,
               by: r.admin_users?.full_name ?? r.participants?.full_name ?? 'system', metadata: r.metadata };
    });

    return ok({ entries });
  } catch (error) {
    return serverError('admin-audit', error);
  }
}
