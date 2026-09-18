export type ParticipantStatus =
  | 'REGISTERED' | 'MOBILE_VERIFIED' | 'EMAIL_VERIFIED' | 'FULLY_VERIFIED'
  | 'SPIN_ELIGIBLE' | 'SPIN_COMPLETED' | 'PRIZE_COLLECTED' | 'BLOCKED';

export type AdminRole = 'SUPER_ADMIN' | 'EVENT_ADMIN' | 'BOOTH_OPERATOR';
export type OtpChannel = 'MOBILE' | 'EMAIL';

export interface EventRow {
  id: string; code: string; name: string; venue: string | null; event_date: string | null;
  registration_start: string | null; registration_end: string | null;
  spin_start: string | null; spin_end: string | null;
  max_participants: number | null; registration_enabled: boolean; spin_enabled: boolean;
  is_active: boolean;
}

export interface ParticipantRow {
  id: string; event_id: string; full_name: string; company: string | null;
  designation: string | null; mobile: string; email: string; status: ParticipantStatus;
  mobile_verified_at: string | null; email_verified_at: string | null; created_at: string;
}

export interface PrizeRow {
  id: string; event_id: string; name: string; display_name: string; description: string | null;
  initial_quantity: number; remaining_quantity: number; weight: number;
  is_active: boolean; display_order: number; color: string | null;
}

export interface PrizeInventoryRow extends Omit<PrizeRow, 'remaining_quantity' | 'description'> {
  allocated: number; remaining: number; collected: number;
}

export interface WinnerRow {
  id: string; event_id: string; participant_id: string; spin_id: string; prize_id: string;
  winner_code: string; won_at: string; collection_status: 'PENDING' | 'COLLECTED';
  collected_at: string | null; collected_by: string | null; collection_notes: string | null;
}

export interface AdminRow {
  id: string; email: string; full_name: string; password_hash: string; role: AdminRole;
  event_id: string | null; is_active: boolean; failed_login_attempts: number;
  locked_until: string | null;
}

export interface SpinResult {
  already_spun: boolean;
  status: 'ALLOCATED' | 'NO_INVENTORY';
  spin_id: string;
  prize: { id: string; name: string; display_name: string; color: string | null } | null;
  winner_code?: string;
  won_at?: string;
  collection_status?: 'PENDING' | 'COLLECTED';
}

export interface EventStats {
  registrations: number; mobile_verified: number; email_verified: number; fully_verified: number;
  spins: number; winners: number; collected: number; pending_collection: number; prizes_remaining: number;
}
