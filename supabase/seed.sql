-- =====================================================================
-- Seed data — TOAP Spin & Win 2026
-- Safe to run on a fresh database. Creates NO admin passwords:
-- use `npm run seed:admin` to create the first SUPER_ADMIN interactively.
-- =====================================================================

insert into events (code, name, venue, event_date,
                    registration_start, registration_end, spin_start, spin_end,
                    max_participants, is_active)
values ('TOAP2026', 'TOAP Spin & Win 2026', 'Manila, Philippines', date '2026-11-12',
        timestamptz '2026-11-12 07:00+08', timestamptz '2026-11-12 18:00+08',
        timestamptz '2026-11-12 07:00+08', timestamptz '2026-11-12 18:00+08',
        null, true)
on conflict (code) do nothing;

insert into event_settings (event_id, key, value)
select e.id, s.key, s.value
from events e,
  (values
    ('branding', '{"organisation":"Trust Officers Association of the Philippines","short_name":"TOAP","logo_url":"/toap-logo.svg","partner":"Powered by Credence Analytics","tagline":"Scan. Verify. Spin. Win."}'::jsonb),
    ('privacy_notice', '{"text":"We collect your name, company, designation, mobile number and email only to verify your entry and hand over your prize at the booth. Data is kept by the event organiser and deleted 90 days after the event."}'::jsonb),
    ('consent_text', '{"text":"I agree to the collection and use of my details for this event, in line with the Philippine Data Privacy Act of 2012."}'::jsonb),
    ('form_fields', '{"company":{"required":true},"designation":{"required":false}}'::jsonb),
    ('otp', '{"ttl_seconds":300,"max_attempts":5,"resend_cooldown_seconds":60,"max_sends_per_hour":5}'::jsonb)
  ) as s(key, value)
where e.code = 'TOAP2026'
on conflict (event_id, key) do nothing;

insert into prizes (event_id, name, display_name, description, initial_quantity, remaining_quantity, weight, display_order, color)
select e.id, p.name, p.display_name, p.description, p.qty, p.qty, p.weight, p.ord, p.color
from events e,
  (values
    ('PEN',        'Pen',        'TOAP commemorative pen',        100, 100, 1, '#0F2742'),
    ('CAP',        'Cap',        'Embroidered event cap',          50,  50, 2, '#157F6B'),
    ('POWER_BANK', 'Power Bank', '10,000 mAh fast-charge power bank', 20, 20, 3, '#C9A227'),
    ('EARPHONES',  'Earphones',  'Wireless earphones',             10,  10, 4, '#1B3C60')
  ) as p(name, display_name, description, qty, weight, ord, color)
where e.code = 'TOAP2026'
on conflict (event_id, name) do nothing;

-- Weights mirror the quantities by default (Pen 100 / Cap 50 / Power Bank 20 /
-- Earphones 10) so the wheel drains roughly evenly. Change them in Admin.
update prizes set weight = initial_quantity
 where event_id = (select id from events where code = 'TOAP2026');
