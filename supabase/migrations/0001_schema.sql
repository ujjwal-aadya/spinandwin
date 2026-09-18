-- =====================================================================
-- TOAP QR Spin & Win — core schema
-- Target: PostgreSQL 15+ (Supabase)
-- All access is server-side through the service role. RLS is enabled on
-- every table with NO policies, so the anon/public key can read nothing.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums
do $$ begin
  create type participant_status as enum (
    'REGISTERED','MOBILE_VERIFIED','EMAIL_VERIFIED','FULLY_VERIFIED',
    'SPIN_ELIGIBLE','SPIN_COMPLETED','PRIZE_COLLECTED','BLOCKED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type otp_channel as enum ('MOBILE','EMAIL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type collection_status as enum ('PENDING','COLLECTED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type admin_role as enum ('SUPER_ADMIN','EVENT_ADMIN','BOOTH_OPERATOR');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- events
create table if not exists events (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,                 -- e.g. TOAP2026
  name                text not null,
  venue               text,
  event_date          date,
  registration_start  timestamptz,
  registration_end    timestamptz,
  spin_start          timestamptz,
  spin_end            timestamptz,
  max_participants    integer check (max_participants is null or max_participants > 0),
  registration_enabled boolean not null default true,
  spin_enabled        boolean not null default true,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Free-form per-event configuration: branding, privacy notice, form fields,
-- OTP tuning. Kept as key/value so new settings need no migration.
create table if not exists event_settings (
  event_id   uuid not null references events(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, key)
);

-- --------------------------------------------------------- participants
create table if not exists participants (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  full_name         text not null,
  company           text,
  designation       text,
  mobile            text not null,            -- normalised E.164, e.g. +639171234567
  email             text not null,            -- normalised lowercase
  status            participant_status not null default 'REGISTERED',
  mobile_verified_at timestamptz,
  email_verified_at  timestamptz,
  consent_at        timestamptz,
  blocked_reason    text,
  ip_hash           text,                     -- hashed, never the raw IP
  user_agent        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One VERIFIED mobile and one VERIFIED email per event (business rule 4).
create unique index if not exists participants_verified_mobile_uq
  on participants (event_id, mobile) where mobile_verified_at is not null;
create unique index if not exists participants_verified_email_uq
  on participants (event_id, email) where email_verified_at is not null;
-- Fast lookup / dedupe of in-flight registrations.
create index if not exists participants_event_mobile_idx on participants (event_id, mobile);
create index if not exists participants_event_email_idx  on participants (event_id, email);
create index if not exists participants_company_idx      on participants (event_id, lower(company));
create index if not exists participants_name_idx         on participants (event_id, lower(full_name));
create index if not exists participants_created_idx      on participants (event_id, created_at desc);

-- ---------------------------------------------------- otp_verifications
create table if not exists otp_verifications (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  channel        otp_channel not null,
  purpose        text not null default 'VERIFY',   -- VERIFY (first time) | CHALLENGE (returning participant)
  destination    text not null,               -- mobile or email at time of send
  code_hash      text not null,               -- HMAC-SHA256(code, OTP_PEPPER). Never plaintext.
  expires_at     timestamptz not null,
  attempts       integer not null default 0,
  max_attempts   integer not null default 5,
  consumed_at    timestamptz,
  invalidated_at timestamptz,
  provider_ref   text,
  ip_hash        text,
  created_at     timestamptz not null default now()
);
create index if not exists otp_active_idx
  on otp_verifications (participant_id, channel, created_at desc);

-- ------------------------------------------------------------- sessions
create table if not exists sessions (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  token_hash     text not null unique,        -- sha256 of the cookie token
  identity_confirmed boolean not null default true, -- false until a returning participant re-verifies
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  ip_hash        text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
create index if not exists sessions_participant_idx on sessions (participant_id);

-- --------------------------------------------------------------- prizes
create table if not exists prizes (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  name               text not null,
  display_name       text not null,
  description        text,
  initial_quantity   integer not null check (initial_quantity >= 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),   -- never negative
  weight             integer not null check (weight >= 0),
  is_active          boolean not null default true,
  display_order      integer not null default 0,
  color              text,                                   -- wheel segment colour
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (event_id, name)
);
create index if not exists prizes_event_active_idx on prizes (event_id, is_active, display_order);

-- Ledger of every inventory change (rule 17).
create table if not exists prize_inventory_adjustments (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events(id) on delete cascade,
  prize_id     uuid not null references prizes(id) on delete cascade,
  previous_qty integer not null,
  adjustment   integer not null,
  new_qty      integer not null,
  reason       text not null,
  admin_id     uuid,
  created_at   timestamptz not null default now()
);
create index if not exists inventory_adj_prize_idx on prize_inventory_adjustments (prize_id, created_at desc);

-- ---------------------------------------------------------------- spins
create table if not exists spins (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  participant_id  uuid not null references participants(id) on delete cascade,
  prize_id        uuid references prizes(id),
  idempotency_key text,
  status          text not null default 'ALLOCATED',   -- ALLOCATED | NO_INVENTORY
  ip_hash         text,
  created_at      timestamptz not null default now(),
  -- THE business rule: one spin per participant per event, enforced by the DB.
  constraint spins_one_per_participant unique (event_id, participant_id)
);
create index if not exists spins_event_created_idx on spins (event_id, created_at desc);

-- -------------------------------------------------------------- winners
create table if not exists winners (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references events(id) on delete cascade,
  participant_id    uuid not null references participants(id) on delete cascade,
  spin_id           uuid not null references spins(id) on delete cascade unique,
  prize_id          uuid not null references prizes(id),
  winner_code       text not null unique,
  won_at            timestamptz not null default now(),
  collection_status collection_status not null default 'PENDING',
  collected_at      timestamptz,
  collected_by      uuid,
  collection_notes  text,
  constraint winners_one_per_participant unique (event_id, participant_id)
);
create index if not exists winners_code_idx    on winners (winner_code);
create index if not exists winners_event_idx   on winners (event_id, won_at desc);
create index if not exists winners_status_idx  on winners (event_id, collection_status);
create index if not exists winners_prize_idx   on winners (event_id, prize_id);

create table if not exists prize_collections (
  id           uuid primary key default gen_random_uuid(),
  winner_id    uuid not null references winners(id) on delete cascade unique,
  admin_id     uuid not null,
  collected_at timestamptz not null default now(),
  notes        text,
  ip_hash      text
);

-- ---------------------------------------------------------- admin users
create table if not exists admin_users (
  id                    uuid primary key default gen_random_uuid(),
  email                 text not null unique,
  full_name             text not null,
  password_hash         text not null,
  role                  admin_role not null default 'BOOTH_OPERATOR',
  event_id              uuid references events(id) on delete set null, -- null = all events
  is_active             boolean not null default true,
  failed_login_attempts integer not null default 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references admin_users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  ip_hash      text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- ----------------------------------------------------------- audit logs
create table if not exists audit_logs (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid references events(id) on delete set null,
  admin_id       uuid references admin_users(id) on delete set null,
  participant_id uuid references participants(id) on delete set null,
  action         text not null,
  entity         text,
  entity_id      text,
  ip_hash        text,
  metadata       jsonb not null default '{}'::jsonb,   -- never contains OTP values
  created_at     timestamptz not null default now()
);
create index if not exists audit_event_idx  on audit_logs (event_id, created_at desc);
create index if not exists audit_action_idx on audit_logs (action, created_at desc);

-- ------------------------------------------------------------ rate limit
create table if not exists rate_limit_events (
  id         bigserial primary key,
  bucket     text not null,        -- otp_send_ip | otp_send_mobile | login_email | spin_ip ...
  key_hash   text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_lookup_idx on rate_limit_events (bucket, key_hash, created_at desc);

-- --------------------------------------------------------- updated_at
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['events','participants','prizes','admin_users'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------ RLS
do $$
declare t text;
begin
  foreach t in array array['events','event_settings','participants','otp_verifications','sessions',
                           'prizes','prize_inventory_adjustments','spins','winners','prize_collections',
                           'admin_users','admin_sessions','audit_logs','rate_limit_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
-- No policies are created on purpose: only the service role (which bypasses
-- RLS) may touch these tables, and it is used exclusively on the server.
