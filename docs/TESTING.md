# Testing

```bash
npm run typecheck
npm run lint
npm test                    # unit; integration self-skips without a database
```

Integration and concurrency tests need real PostgreSQL. They will not run against a
mock, because what they are testing is PostgreSQL's locking behaviour.

```bash
createdb toap_test
psql -d toap_test -f supabase/migrations/0001_schema.sql
psql -d toap_test -f supabase/migrations/0002_functions.sql
TEST_DATABASE_URL=postgres://localhost/toap_test npm run test:integration
```

## Coverage

Unit (`tests/unit`, 25 tests)

- OTP generation is 6 digits and uses a CSPRNG; hashes are peppered and compare in constant time
- OTP expiry and attempt counting
- Winner codes: format, alphabet excludes 0/O/1/I, no collisions across a large sample
- Weighted selection: distribution matches configured weights, zero-weight and zero-stock prizes excluded
- Philippine mobile normalisation: `09XX`, `+639XX`, `639XX`, spaces and dashes all converge; rejects landlines and foreign numbers
- Email normalisation, name and company validation, control-character rejection
- CSV escaping, including commas, quotes and formula injection prefixes

Integration (`tests/integration`, 15 tests, real PostgreSQL)

- Allocation decrements exactly one unit and writes exactly one spin and one winner
- Weighted distribution over many allocations stays within tolerance
- An unverified participant cannot spin
- A second call returns the first result rather than a second prize
- Inventory exhaustion returns `NO_INVENTORY` and creates no winner record
- **Concurrency**: eight simultaneous spins with one Power Bank in stock — at most one
  gets it, stock always equals what was handed out, remaining never goes below zero
- **Concurrency, last unit**: one item and eight spinners — exactly one is allocated, the
  other seven are told the prizes are gone, no phantom winner records
- Collection is idempotent; a second attempt reports the first collection
- Inventory adjustment refuses to take remaining below zero

## Results on this build

```
tsc --noEmit                      clean
next build                        succeeds, 23 routes
vitest run tests/unit             25 passed
vitest run tests/integration      15 passed   (PostgreSQL 16)
```

## Manual, before the event

These cannot be automated usefully and must be done against the deployed URL:

- [ ] SMS delivery through Semaphore to a real Philippine number, timed
- [ ] Email delivery through Resend to Gmail, Outlook and one bank domain
- [ ] Full run on Android Chrome and iOS Safari, from a QR scan rather than a typed URL
- [ ] Airplane mode mid-spin, then reconnect: the same prize comes back
- [ ] Two phones spinning for the last item at the same moment
- [ ] Booth flow on the device booth staff will actually hold
- [ ] Admin reports export and open cleanly in Excel
