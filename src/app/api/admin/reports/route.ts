import { db } from '@/lib/db';
import { activeEvent } from '@/lib/event';
import { requireAdmin, ROLES } from '@/lib/session';
import { toCsv, csvResponse } from '@/lib/csv';
import { audit } from '@/lib/audit';
import { fail, ipHash, serverError, ERRORS } from '@/lib/http';

export const dynamic = 'force-dynamic';

type ReportType = 'registrations' | 'spins' | 'winners' | 'inventory' | 'collections' | 'audit';
const TYPES: ReportType[] = ['registrations', 'spins', 'winners', 'inventory', 'collections', 'audit'];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin(ROLES.management);
    if (!admin) return fail(ERRORS.FORBIDDEN, 403, 'FORBIDDEN');

    const event = await activeEvent();
    if (!event) return fail('No active event.', 404, 'NO_EVENT');

    const type = (new URL(req.url).searchParams.get('type') ?? 'winners') as ReportType;
    if (!TYPES.includes(type)) return fail('Unknown report type.', 400, 'BAD_TYPE');

    const stamp = new Date().toISOString().slice(0, 10);
    await audit({ eventId: event.id, adminId: admin.id, action: 'REPORT_EXPORTED',
      entity: 'report', entityId: type, ipHash: ipHash(req) });

    if (type === 'inventory') {
      const { data } = await db().from('prize_inventory').select('*').eq('event_id', event.id)
        .order('display_order').returns<Record<string, unknown>[]>();
      const rows = (data ?? []).map((p) => [
        String(p.display_name), Number(p.initial_quantity), Number(p.allocated),
        Number(p.remaining), Number(p.collected), Number(p.weight), p.is_active ? 'Active' : 'Inactive',
      ]);
      return csvResponse(`${event.code}-inventory-${stamp}.csv`,
        toCsv(['Prize', 'Initial', 'Allocated', 'Remaining', 'Collected', 'Weight', 'Status'], rows));
    }

    if (type === 'audit') {
      const { data } = await db().from('audit_logs')
        .select('created_at, action, entity, entity_id, metadata')
        .eq('event_id', event.id).order('created_at', { ascending: false }).limit(10000)
        .returns<Record<string, unknown>[]>();
      const rows = (data ?? []).map((a) => [
        String(a.created_at), String(a.action), String(a.entity ?? ''), String(a.entity_id ?? ''),
        JSON.stringify(a.metadata ?? {}),
      ]);
      return csvResponse(`${event.code}-audit-${stamp}.csv`,
        toCsv(['Timestamp', 'Action', 'Entity', 'Entity ID', 'Metadata'], rows));
    }

    // Registration / spin / winner / collection reports all read the participant
    // record with its spin and winner, then project the columns each one needs.
    const { data } = await db().from('participants')
      .select(`full_name, company, designation, mobile, email, status, created_at,
               mobile_verified_at, email_verified_at,
               spins(created_at, status),
               winners(winner_code, won_at, collection_status, collected_at, collection_notes, prizes(display_name))`)
      .eq('event_id', event.id).order('created_at', { ascending: true })
      .returns<Record<string, unknown>[]>();

    const flat = (data ?? []).map((row) => {
      const r = row as unknown as {
        full_name: string; company: string | null; designation: string | null; mobile: string;
        email: string; status: string; created_at: string;
        mobile_verified_at: string | null; email_verified_at: string | null;
        spins: { created_at: string; status: string }[] | { created_at: string; status: string } | null;
        winners: unknown;
      };
      const spin = Array.isArray(r.spins) ? r.spins[0] : r.spins;
      const winnerRaw = Array.isArray(r.winners) ? r.winners[0] : r.winners;
      const winner = winnerRaw as null | {
        winner_code: string; won_at: string; collection_status: string;
        collected_at: string | null; collection_notes: string | null; prizes: { display_name: string } | null;
      };
      return {
        name: r.full_name, company: r.company ?? '', designation: r.designation ?? '',
        mobile: r.mobile, email: r.email, status: r.status, registeredAt: r.created_at,
        verification: r.mobile_verified_at && r.email_verified_at ? 'Fully verified'
          : r.mobile_verified_at ? 'Mobile only' : r.email_verified_at ? 'Email only' : 'Not verified',
        spinAt: spin?.created_at ?? '', spinStatus: spin?.status ?? 'Not spun',
        prize: winner?.prizes?.display_name ?? '', code: winner?.winner_code ?? '',
        wonAt: winner?.won_at ?? '', collection: winner?.collection_status ?? '',
        collectedAt: winner?.collected_at ?? '', notes: winner?.collection_notes ?? '',
      };
    });

    if (type === 'registrations') {
      return csvResponse(`${event.code}-registrations-${stamp}.csv`, toCsv(
        ['Name', 'Company', 'Designation', 'Mobile', 'Email', 'Verification', 'Spin status', 'Prize',
         'Winner code', 'Collection', 'Registered at'],
        flat.map((r) => [r.name, r.company, r.designation, r.mobile, r.email, r.verification,
                         r.spinStatus, r.prize, r.code, r.collection, r.registeredAt])));
    }

    if (type === 'spins') {
      return csvResponse(`${event.code}-spins-${stamp}.csv`, toCsv(
        ['Name', 'Company', 'Mobile', 'Spin status', 'Prize', 'Winner code', 'Spun at'],
        flat.filter((r) => r.spinAt).map((r) => [r.name, r.company, r.mobile, r.spinStatus, r.prize,
                                                 r.code, r.spinAt])));
    }

    if (type === 'collections') {
      return csvResponse(`${event.code}-collections-${stamp}.csv`, toCsv(
        ['Winner code', 'Name', 'Company', 'Prize', 'Collection', 'Collected at', 'Notes'],
        flat.filter((r) => r.code).map((r) => [r.code, r.name, r.company, r.prize, r.collection,
                                               r.collectedAt, r.notes])));
    }

    return csvResponse(`${event.code}-winners-${stamp}.csv`, toCsv(
      ['Winner code', 'Name', 'Company', 'Designation', 'Mobile', 'Email', 'Prize', 'Won at', 'Collection'],
      flat.filter((r) => r.code).map((r) => [r.code, r.name, r.company, r.designation, r.mobile,
                                             r.email, r.prize, r.wonAt, r.collection])));
  } catch (error) {
    return serverError('admin-reports', error);
  }
}
