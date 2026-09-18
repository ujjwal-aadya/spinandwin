# Admin guide

Sign in at `/admin`. Your role decides what you see.

| Role | Can |
|---|---|
| `SUPER_ADMIN` | Everything, including event configuration and creating admins |
| `EVENT_ADMIN` | Prizes, inventory, winners, reports, audit |
| `BOOTH_OPERATOR` | Search a winner and mark a prize collected. Contact details are masked |

## Dashboard

Live counters: registrations, mobile verified, email verified, fully verified, spins,
winners, prizes collected, prizes pending. The funnel is the useful part during the
event — a gap between registrations and mobile verified means SMS is struggling, a gap
between fully verified and spins means people are walking away at the wheel.

## Prizes

The prize table shows initial quantity, allocated, remaining, collected, weight and
status. Weights are relative, not percentages: with Pen 100, Cap 50, Power Bank 20 and
Earphones 10, a pen is ten times likelier than earphones. A prize with zero remaining
drops off the wheel automatically. A prize set inactive drops off immediately.

Changing weights mid-event is allowed and takes effect on the next spin. Changing them
after the first spin is recorded asks for confirmation, and every change is audited.

## Inventory adjustment

Use this when the physical stock does not match the system — a box was miscounted, extra
stock arrived, a prize was damaged. Enter the delta, not the new total, and a reason:

```
Power Bank   previous 20   adjustment +10   new 30
Reason: additional stock received from marketing
```

The system will not let remaining go below zero. Every adjustment records who, when and why.

## Winners

Search by winner code, mobile, email, name or company. Filter by prize or by collection
status. Winner detail shows name, company, designation, mobile, email, prize, code, spin
time and collection status.

`MARK AS COLLECTED` is one-way and records the admin, the timestamp and any notes. A
second attempt tells you when it was collected and by whom rather than creating another
record. Winners cannot be deleted; correct mistakes with a note and an inventory
adjustment.

## Event controls

Registration and spinning can each be paused independently — use this for a lunch break,
a programme overrun, or if you need to stop the booth while you count stock. Outside the
configured windows both close automatically. The times are Manila time.

## Reports

Six CSV exports: registrations, spins, winners, inventory, collections, audit. The
registration export carries name, company, designation, mobile, email, verification
status, spin status, prize, winner code, collection status and timestamps — that is the
file the organiser usually wants. Exports are themselves audited.
