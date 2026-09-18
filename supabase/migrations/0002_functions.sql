-- =====================================================================
-- TOAP QR Spin & Win — authoritative business logic
-- Prize allocation lives in the database so that concurrency, inventory
-- and the one-spin rule are guaranteed by transactions, not by app code.
-- =====================================================================

-- Crypto-random integer in [0, n) using pgcrypto (not the seeded random()).
create or replace function secure_random_int(n bigint)
returns bigint language plpgsql as $$
declare v bigint;
begin
  if n <= 0 then return 0; end if;
  v := ('x' || encode(gen_random_bytes(6), 'hex'))::bit(48)::bigint;  -- 0 .. 2^48-1
  return v % n;
end $$;

-- Non-sequential winner code, ambiguous characters removed (no 0/O/1/I/L).
create or replace function gen_winner_code(p_prefix text default 'TOAP', p_len int default 6)
returns text language plpgsql as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
  i int;
begin
  for i in 1..p_len loop
    out := out || substr(alphabet, (secure_random_int(length(alphabet)))::int + 1, 1);
  end loop;
  return p_prefix || '-' || out;
end $$;

-- ---------------------------------------------------------------------
-- allocate_spin: the single entry point for spinning.
-- Idempotent, transactional, inventory-safe.
-- ---------------------------------------------------------------------
create or replace function allocate_spin(
  p_event_id       uuid,
  p_participant_id uuid,
  p_ip_hash        text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
as $$
declare
  v_status      participant_status;
  v_spin        spins%rowtype;
  v_winner      winners%rowtype;
  v_prize       prizes%rowtype;
  v_total       bigint := 0;
  v_pick        bigint;
  v_cursor      bigint := 0;
  v_chosen      uuid;
  v_code        text;
  v_attempts    int := 0;
  r             record;
begin
  -- Serialise every concurrent request for THIS participant (double click,
  -- second tab, replayed request) on one transaction-scoped advisory lock.
  perform pg_advisory_xact_lock(hashtextextended(p_participant_id::text, 20260101));

  -- 1. Idempotency: if a spin already exists, return it. Never allocate twice.
  select * into v_spin from spins
   where event_id = p_event_id and participant_id = p_participant_id;
  if found then
    select * into v_winner from winners where spin_id = v_spin.id;
    if v_winner.id is not null then
      select * into v_prize from prizes where id = v_winner.prize_id;
      return jsonb_build_object(
        'already_spun', true, 'status', v_spin.status, 'spin_id', v_spin.id,
        'prize', jsonb_build_object('id', v_prize.id, 'name', v_prize.name,
                 'display_name', v_prize.display_name, 'color', v_prize.color),
        'winner_code', v_winner.winner_code, 'won_at', v_winner.won_at,
        'collection_status', v_winner.collection_status);
    end if;
    return jsonb_build_object('already_spun', true, 'status', v_spin.status,
                              'spin_id', v_spin.id, 'prize', null);
  end if;

  -- 2. Eligibility is read from the database, never from the client.
  select status into v_status from participants
   where id = p_participant_id and event_id = p_event_id for update;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_status = 'BLOCKED' then raise exception 'PARTICIPANT_BLOCKED' using errcode = 'P0003'; end if;
  if v_status not in ('FULLY_VERIFIED','SPIN_ELIGIBLE') then
    raise exception 'NOT_ELIGIBLE' using errcode = 'P0004';
  end if;

  -- 3. Lock every allocatable prize in a deterministic order (deadlock-free),
  --    then pick one with crypto-random weighted selection.
  for r in
    select id, weight, remaining_quantity from prizes
     where event_id = p_event_id and is_active and remaining_quantity > 0 and weight > 0
     order by id
     for update
  loop
    v_total := v_total + r.weight;
  end loop;

  if v_total = 0 then
    -- Inventory exhausted: record the attempt so the participant is not
    -- silently retried into another prize later.
    insert into spins (event_id, participant_id, prize_id, idempotency_key, status, ip_hash)
    values (p_event_id, p_participant_id, null, p_idempotency_key, 'NO_INVENTORY', p_ip_hash)
    returning * into v_spin;
    update participants set status = 'SPIN_COMPLETED' where id = p_participant_id;
    insert into audit_logs (event_id, participant_id, action, entity, entity_id, ip_hash, metadata)
    values (p_event_id, p_participant_id, 'SPIN_NO_INVENTORY', 'spin', v_spin.id::text, p_ip_hash, '{}'::jsonb);
    return jsonb_build_object('already_spun', false, 'status', 'NO_INVENTORY',
                              'spin_id', v_spin.id, 'prize', null);
  end if;

  v_pick := secure_random_int(v_total);
  for r in
    select id, weight from prizes
     where event_id = p_event_id and is_active and remaining_quantity > 0 and weight > 0
     order by id
  loop
    v_cursor := v_cursor + r.weight;
    if v_pick < v_cursor then v_chosen := r.id; exit; end if;
  end loop;

  -- 4. Decrement inventory atomically. The guard makes a negative value
  --    impossible even if this function is ever called outside the lock.
  update prizes set remaining_quantity = remaining_quantity - 1
   where id = v_chosen and remaining_quantity > 0
  returning * into v_prize;
  if not found then raise exception 'INVENTORY_RACE' using errcode = 'P0005'; end if;

  -- 5. Spin + winner records inside the same transaction.
  insert into spins (event_id, participant_id, prize_id, idempotency_key, status, ip_hash)
  values (p_event_id, p_participant_id, v_chosen, p_idempotency_key, 'ALLOCATED', p_ip_hash)
  returning * into v_spin;

  loop
    v_attempts := v_attempts + 1;
    v_code := gen_winner_code('TOAP', 6);
    begin
      insert into winners (event_id, participant_id, spin_id, prize_id, winner_code)
      values (p_event_id, p_participant_id, v_spin.id, v_chosen, v_code)
      returning * into v_winner;
      exit;
    exception when unique_violation then
      if v_attempts >= 10 then raise; end if;
    end;
  end loop;

  update participants set status = 'SPIN_COMPLETED' where id = p_participant_id;

  insert into audit_logs (event_id, participant_id, action, entity, entity_id, ip_hash, metadata)
  values
    (p_event_id, p_participant_id, 'SPIN_INITIATED', 'spin', v_spin.id::text, p_ip_hash, '{}'::jsonb),
    (p_event_id, p_participant_id, 'PRIZE_ALLOCATED', 'prize', v_chosen::text, p_ip_hash,
     jsonb_build_object('prize', v_prize.name, 'remaining_after', v_prize.remaining_quantity)),
    (p_event_id, p_participant_id, 'WINNER_CREATED', 'winner', v_winner.id::text, p_ip_hash,
     jsonb_build_object('winner_code', v_winner.winner_code));

  return jsonb_build_object(
    'already_spun', false, 'status', 'ALLOCATED', 'spin_id', v_spin.id,
    'prize', jsonb_build_object('id', v_prize.id, 'name', v_prize.name,
             'display_name', v_prize.display_name, 'color', v_prize.color),
    'winner_code', v_winner.winner_code, 'won_at', v_winner.won_at,
    'collection_status', v_winner.collection_status);
end $$;

-- ---------------------------------------------------------------------
-- collect_prize: marking a prize collected exactly once.
-- ---------------------------------------------------------------------
create or replace function collect_prize(
  p_winner_id uuid, p_admin_id uuid, p_notes text default null, p_ip_hash text default null
) returns jsonb
language plpgsql as $$
declare v_winner winners%rowtype;
begin
  update winners
     set collection_status = 'COLLECTED', collected_at = now(),
         collected_by = p_admin_id, collection_notes = p_notes
   where id = p_winner_id and collection_status = 'PENDING'
  returning * into v_winner;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_COLLECTED');
  end if;

  insert into prize_collections (winner_id, admin_id, notes, ip_hash)
  values (v_winner.id, p_admin_id, p_notes, p_ip_hash);

  update participants set status = 'PRIZE_COLLECTED' where id = v_winner.participant_id;

  insert into audit_logs (event_id, admin_id, participant_id, action, entity, entity_id, ip_hash, metadata)
  values (v_winner.event_id, p_admin_id, v_winner.participant_id, 'PRIZE_COLLECTED', 'winner',
          v_winner.id::text, p_ip_hash, jsonb_build_object('winner_code', v_winner.winner_code));

  return jsonb_build_object('ok', true, 'collected_at', v_winner.collected_at);
end $$;

-- ---------------------------------------------------------------------
-- adjust_inventory: audited, never negative, never below what is allocated.
-- ---------------------------------------------------------------------
create or replace function adjust_inventory(
  p_prize_id uuid, p_delta int, p_reason text, p_admin_id uuid
) returns jsonb
language plpgsql as $$
declare v_prize prizes%rowtype; v_prev int; v_new int;
begin
  select * into v_prize from prizes where id = p_prize_id for update;
  if not found then raise exception 'PRIZE_NOT_FOUND' using errcode = 'P0002'; end if;

  v_prev := v_prize.remaining_quantity;
  v_new  := v_prev + p_delta;
  if v_new < 0 then raise exception 'NEGATIVE_INVENTORY' using errcode = 'P0006'; end if;

  update prizes
     set remaining_quantity = v_new,
         initial_quantity = greatest(initial_quantity + greatest(p_delta, 0), initial_quantity)
   where id = p_prize_id;

  insert into prize_inventory_adjustments (event_id, prize_id, previous_qty, adjustment, new_qty, reason, admin_id)
  values (v_prize.event_id, p_prize_id, v_prev, p_delta, v_new, p_reason, p_admin_id);

  insert into audit_logs (event_id, admin_id, action, entity, entity_id, metadata)
  values (v_prize.event_id, p_admin_id, 'INVENTORY_CHANGED', 'prize', p_prize_id::text,
          jsonb_build_object('previous', v_prev, 'adjustment', p_delta, 'new', v_new, 'reason', p_reason));

  return jsonb_build_object('previous', v_prev, 'adjustment', p_delta, 'new', v_new);
end $$;

-- ---------------------------------------------------------------------
-- event_stats: one round trip for the dashboard.
-- ---------------------------------------------------------------------
create or replace function event_stats(p_event_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'registrations',      (select count(*) from participants where event_id = p_event_id),
    'mobile_verified',    (select count(*) from participants where event_id = p_event_id and mobile_verified_at is not null),
    'email_verified',     (select count(*) from participants where event_id = p_event_id and email_verified_at is not null),
    'fully_verified',     (select count(*) from participants where event_id = p_event_id
                             and mobile_verified_at is not null and email_verified_at is not null),
    'spins',              (select count(*) from spins where event_id = p_event_id),
    'winners',            (select count(*) from winners where event_id = p_event_id),
    'collected',          (select count(*) from winners where event_id = p_event_id and collection_status = 'COLLECTED'),
    'pending_collection', (select count(*) from winners where event_id = p_event_id and collection_status = 'PENDING'),
    'prizes_remaining',   (select coalesce(sum(remaining_quantity),0) from prizes where event_id = p_event_id and is_active)
  );
$$;

-- Inventory view used by the admin prize table.
create or replace view prize_inventory as
  select p.id, p.event_id, p.name, p.display_name, p.weight, p.is_active, p.display_order, p.color,
         p.initial_quantity,
         (select count(*) from winners w where w.prize_id = p.id) as allocated,
         p.remaining_quantity as remaining,
         (select count(*) from winners w where w.prize_id = p.id and w.collection_status = 'COLLECTED') as collected
    from prizes p;
