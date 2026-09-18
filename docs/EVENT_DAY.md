# Event day

One page. Print it and leave it on the booth table.

## Setup, 30 minutes before doors

- [ ] Open `https://toap.credenceanalytics.com` on a phone and complete one full test run
- [ ] Count physical prizes and match them against `/admin` → prizes
- [ ] Booth devices signed in at `/booth`, screens set not to sleep
- [ ] Printed QR codes on the table and on the standee, spare copy to hand
- [ ] Booth wifi or mobile data tested where the attendees will be standing, not at the desk
- [ ] Prizes arranged so the small ones are easy to reach; pens are most of the volume

## Attendee

Scan the QR → enter details → type the code from the SMS → type the code from the email
→ spin → show the winner code.

## Booth staff

1. Ask for the winner code, or search their mobile number.
2. Check the name on screen matches the person.
3. Hand over the prize.
4. `MARK AS COLLECTED`.

Never hand over a prize before marking it, and never mark it before handing it over.

## Admin

Watch remaining inventory. When a prize runs out it disappears from the wheel on its
own — no action needed. Export the winners CSV at lunch and again at close, so a
network problem at the end of the day cannot cost you the record.

## When something goes wrong

| Problem | Do |
|---|---|
| SMS not arriving | Check Semaphore credits first, it is usually credits. Ask the attendee to wait 60 seconds and use resend once. If Semaphore is down, pause registration in `/admin` rather than letting people queue |
| Email not arriving | Ask them to check spam. Gmail on corporate accounts is the usual delay |
| Attendee says the wheel froze | Ask them to refresh. Their prize is already allocated and the same result comes back. They have not lost anything |
| Attendee wants a second spin | One spin per person. The system will not allow it and neither should the booth |
| Two people, one phone | Each needs their own mobile number and email. A shared number gets one spin |
| Prize physically out but the system shows stock | Adjust inventory down with a reason, do not just stop handing it out |
| System unreachable | Write down name, mobile and a prize on paper, hand over the prize, reconcile afterwards with an inventory adjustment. Do not stop the event for the software |

## Close

- [ ] Pause registration and spins in `/admin`
- [ ] Export all six reports
- [ ] Count remaining stock against the inventory report and note any difference
- [ ] Hand the winners file to the organiser
- [ ] Agree when participant data gets deleted
