import { db } from './db';
import { maskEmail, maskMobile } from './validation';
import type { ParticipantSession } from './session';
import type { PrizeRow } from './types';

export type Stage =
  | 'REGISTER' | 'CHALLENGE' | 'VERIFY_MOBILE' | 'VERIFY_EMAIL' | 'READY' | 'RESULT' | 'BLOCKED';

export interface PublicPrize { id: string; displayName: string; color: string; soldOut: boolean }

export interface ParticipantState {
  stage: Stage;
  participant: { fullName: string; company: string | null; mobileMasked: string; emailMasked: string;
                 mobileVerified: boolean; emailVerified: boolean };
  result: null | {
    prize: string | null; winnerCode: string | null; wonAt: string | null;
    collectionStatus: 'PENDING' | 'COLLECTED' | null; noInventory: boolean;
  };
}

/** Wheel segments. Quantities are never sent to the browser. */
export async function publicPrizes(eventId: string): Promise<PublicPrize[]> {
  const { data } = await db()
    .from('prizes')
    .select('id, display_name, color, remaining_quantity, weight, is_active, display_order')
    .eq('event_id', eventId).eq('is_active', true)
    .order('display_order', { ascending: true })
    .returns<Pick<PrizeRow, 'id' | 'display_name' | 'color' | 'remaining_quantity' | 'weight' | 'is_active' | 'display_order'>[]>();

  return (data ?? []).map((p) => ({
    id: p.id,
    displayName: p.display_name,
    color: p.color ?? '#0F2742',
    soldOut: p.remaining_quantity <= 0,
  }));
}

export async function participantState(session: ParticipantSession): Promise<ParticipantState> {
  const p = session.participant;

  const { data: spin } = await db()
    .from('spins')
    .select('id, status, winners(winner_code, won_at, collection_status, prizes(display_name))')
    .eq('participant_id', p.id).maybeSingle();

  const spinRow = spin as null | {
    status: string;
    winners: { winner_code: string; won_at: string; collection_status: 'PENDING' | 'COLLECTED';
               prizes: { display_name: string } | null } | null;
  };

  const base: ParticipantState['participant'] = {
    fullName: p.full_name, company: p.company,
    mobileMasked: maskMobile(p.mobile), emailMasked: maskEmail(p.email),
    mobileVerified: Boolean(p.mobile_verified_at), emailVerified: Boolean(p.email_verified_at),
  };

  if (p.status === 'BLOCKED') return { stage: 'BLOCKED', participant: base, result: null };

  // A returning participant must pass a fresh code before anything is revealed.
  if (!session.identityConfirmed) return { stage: 'CHALLENGE', participant: base, result: null };

  if (spinRow) {
    const w = spinRow.winners;
    return {
      stage: 'RESULT',
      participant: base,
      result: {
        prize: w?.prizes?.display_name ?? null,
        winnerCode: w?.winner_code ?? null,
        wonAt: w?.won_at ?? null,
        collectionStatus: w?.collection_status ?? null,
        noInventory: spinRow.status === 'NO_INVENTORY',
      },
    };
  }

  if (!p.mobile_verified_at) return { stage: 'VERIFY_MOBILE', participant: base, result: null };
  if (!p.email_verified_at) return { stage: 'VERIFY_EMAIL', participant: base, result: null };
  return { stage: 'READY', participant: base, result: null };
}
