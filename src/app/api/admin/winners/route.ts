import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { requireAdmin, ROLES } from '@/lib/session';
import { normalisePhMobile, maskEmail, maskMobile } from '@/lib/validation';
import { isValidWinnerCode } from '@/lib/crypto';
import { ok, fail, serverError, ERRORS } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Strips anything PostgREST could read as filter syntax. */
function sanitise(term: string): string {
  return term.trim().slice(0, 80).replace(/[^\p{L}\p{N}@._+\- ]/gu, '');
}

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(ROLES.all);
    if (!admin) return fail(ERRORS.FORBIDDEN, 401, 'NO_SESSION');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const url = new URL(req.url);
    const q = sanitise(url.searchParams.get('q') ?? '');
    const prizeId = url.searchParams.get('prize');
    const status = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);

    let query = db().from('winners')
      .select(`id, winner_code, won_at, collection_status, collected_at, collection_notes,
               prizes(id, display_name),
               participants(full_name, company, designation, mobile, email)`)
      .eq('event_id', event.id)
      .order('won_at', { ascending: false })
      .limit(limit);

    if (prizeId) query = query.eq('prize_id', prizeId);
    if (status === 'PENDING' || status === 'COLLECTED') query = query.eq('collection_status', status);

    if (q) {
      if (isValidWinnerCode(q)) {
        query = query.eq('winner_code', q.toUpperCase());
      } else {
        const mobile = normalisePhMobile(q);
        const like = `%${q}%`;
        const { data: matches } = await db().from('participants').select('id').eq('event_id', event.id)
          .or(mobile
            ? `mobile.eq.${mobile}`
            : `full_name.ilike.${like},company.ilike.${like},email.ilike.${like},mobile.ilike.${like}`)
          .limit(200).returns<{ id: string }[]>();
        const ids = (matches ?? []).map((m) => m.id);
        if (ids.length === 0) return ok({ winners: [], role: admin.role });
        query = query.in('participant_id', ids);
      }
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const booth = admin.role === 'BOOTH_OPERATOR';
    const winners = (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string; winner_code: string; won_at: string;
        collection_status: 'PENDING' | 'COLLECTED'; collected_at: string | null; collection_notes: string | null;
        prizes: { id: string; display_name: string } | null;
        participants: { full_name: string; company: string | null; designation: string | null;
                        mobile: string; email: string } | null;
      };
      return {
        id: r.id,
        winnerCode: r.winner_code,
        wonAt: r.won_at,
        collectionStatus: r.collection_status,
        collectedAt: r.collected_at,
        notes: r.collection_notes,
        prize: r.prizes?.display_name ?? '—',
        prizeId: r.prizes?.id ?? null,
        name: r.participants?.full_name ?? '—',
        company: r.participants?.company ?? '—',
        designation: r.participants?.designation ?? '—',
        // Booth staff only need enough to confirm identity at the table.
        mobile: booth ? maskMobile(r.participants?.mobile ?? '') : r.participants?.mobile ?? '',
        email: booth ? maskEmail(r.participants?.email ?? '') : r.participants?.email ?? '',
      };
    });

    return ok({ winners, role: admin.role });
  } catch (error) {
    return serverError('admin-winners', error);
  }
}
