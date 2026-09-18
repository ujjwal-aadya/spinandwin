'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, RequestFailed } from '@/lib/client';
import { Banner, Card, Field, Footer, Spinner, Title } from './ui';
import { Wheel, rotationFor, type Segment } from './Wheel';

type ServerStage = 'REGISTER' | 'CHALLENGE' | 'VERIFY_MOBILE' | 'VERIFY_EMAIL' | 'READY' | 'RESULT' | 'BLOCKED';

interface Config {
  event: { name: string; venue: string | null; date: string | null };
  branding: { organisation: string; short_name: string; partner?: string; tagline?: string };
  privacyNotice: string;
  consentText: string;
  prizes: Segment[];
  registration: { state: string; message: string };
  spin: { state: string; message: string };
}

interface State {
  stage: ServerStage;
  participant: null | { fullName: string; mobileMasked: string; emailMasked: string;
                        mobileVerified: boolean; emailVerified: boolean };
  result: null | { prize: string | null; winnerCode: string | null; wonAt: string | null;
                   collectionStatus: 'PENDING' | 'COLLECTED' | null; noInventory: boolean };
}

interface SpinResponse {
  alreadySpun: boolean; noInventory: boolean;
  prize: { id: string; displayName: string; color: string | null } | null;
  winnerCode: string | null; wonAt: string | null;
  collectionStatus: 'PENDING' | 'COLLECTED'; participantName: string;
}

export function SpinFlow() {
  const [config, setConfig] = useState<Config | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [started, setStarted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfg, me] = await Promise.all([api<Config>('/api/config'), api<State>('/api/me')]);
      setConfig(cfg);
      setState(me);
      if (me.stage !== 'REGISTER') setStarted(true);
    } catch (error) {
      setBootError(error instanceof RequestFailed ? error.message : 'We could not load the event.');
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch: state lands after the request resolves
  useEffect(() => { void load(); }, [load]);

  if (bootError) {
    return <Shell><Card><Title>We could not load the event</Title><Banner tone="error">{bootError}</Banner>
      <button className="btn btn-primary" onClick={() => { setBootError(null); void load(); }}>Try again</button>
    </Card></Shell>;
  }

  if (!config || !state) {
    return <Shell><Card><div className="flex min-h-[160px] items-center justify-center text-navy/60">
      <Spinner label="Loading the event" /></div></Card></Shell>;
  }

  const closed = config.registration.state !== 'OPEN' && state.stage === 'REGISTER';

  return (
    <Shell partner={config.branding.partner}>
      {closed ? (
        <Card><Title sub={config.registration.message}>{config.event.name}</Title></Card>
      ) : state.stage === 'BLOCKED' ? (
        <Card><Title sub="Please speak to the booth staff for help.">This entry is on hold</Title></Card>
      ) : state.stage === 'RESULT' ? (
        <Result config={config} state={state} />
      ) : state.stage === 'READY' ? (
        <SpinStage config={config} onResult={(s) => setState(s)} />
      ) : state.stage === 'REGISTER' ? (
        started
          ? <Registration config={config} onDone={setState} onBack={() => setStarted(false)} />
          : <Welcome config={config} onStart={() => setStarted(true)} />
      ) : (
        <Verification state={state} onDone={setState} />
      )}
    </Shell>
  );
}

function Shell({ children, partner }: { children: React.ReactNode; partner?: string }) {
  return (
    <main className="stage flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-[440px]">{children}<Footer partner={partner} /></div>
    </main>
  );
}

// ------------------------------------------------------------------ welcome
function Welcome({ config, onStart }: { config: Config; onStart: () => void }) {
  return (
    <>
      <div className="mb-6 text-center text-white">
        <p className="text-[13px] uppercase tracking-[.18em] text-brass-light">{config.branding.short_name}</p>
        <h1 className="mt-3 font-display text-[40px] leading-[1.05]">{config.event.name}</h1>
        <p className="mt-3 text-[16px] text-white/75">{config.branding.tagline ?? 'Scan. Verify. Spin. Win.'}</p>
      </div>
      <Card>
        <p className="text-[15px] leading-relaxed text-navy/75">
          Enter your details, confirm the codes we send to your mobile and email, then take your one spin
          of the wheel. It takes about a minute.
        </p>
        <ul className="my-5 space-y-2 text-[15px] text-navy">
          {config.prizes.map((prize) => (
            <li key={prize.id} className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full" style={{ background: prize.color }} aria-hidden="true" />
              {prize.displayName}
            </li>
          ))}
        </ul>
        <button className="btn btn-gold" onClick={onStart}>Start</button>
        <p className="mt-4 text-[12.5px] leading-snug text-navy/55">{config.privacyNotice}</p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------- registration
function Registration({ config, onDone, onBack }:
  { config: Config; onDone: (s: State) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(form: FormData) {
    setBusy(true); setMessage(null); setFields({});
    try {
      const state = await api<State>('/api/register', {
        method: 'POST',
        json: {
          fullName: String(form.get('fullName') ?? ''),
          company: String(form.get('company') ?? ''),
          designation: String(form.get('designation') ?? ''),
          mobile: String(form.get('mobile') ?? ''),
          email: String(form.get('email') ?? ''),
          consent: form.get('consent') === 'on',
        },
      });
      onDone(state);
    } catch (error) {
      if (error instanceof RequestFailed) {
        setMessage(error.message);
        setFields(error.detail.fields ?? {});
      } else setMessage('We could not save your details. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Title sub="We use these details to verify your entry and hand over your prize.">Your details</Title>
      {message ? <Banner tone="error">{message}</Banner> : null}
      <form onSubmit={(e) => { e.preventDefault(); void submit(new FormData(e.currentTarget)); }} noValidate>
        <Field label="Full name" name="fullName" autoComplete="name" required error={fields.fullName} />
        <Field label="Company or institution" name="company" autoComplete="organization" required
               error={fields.company} />
        <Field label="Designation" name="designation" autoComplete="organization-title"
               hint="Optional" error={fields.designation} />
        <Field label="Mobile number" name="mobile" type="tel" inputMode="tel" autoComplete="tel" required
               placeholder="0917 123 4567" hint="Philippine mobile number" error={fields.mobile} />
        <Field label="Email address" name="email" type="email" inputMode="email" autoComplete="email" required
               error={fields.email} />
        <label className="mb-5 flex items-start gap-3 text-[13.5px] leading-snug text-navy/75">
          <input type="checkbox" name="consent" required
                 className="mt-0.5 h-5 w-5 shrink-0 accent-[#0F2742]" />
          <span>{config.consentText}</span>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? <Spinner label="Sending codes" /> : 'Continue'}
        </button>
      </form>
      <button className="btn btn-quiet mt-3" type="button" onClick={onBack}>Back</button>
    </Card>
  );
}

// ------------------------------------------------------------- verification
function Verification({ state, onDone }: { state: State; onDone: (s: State) => void }) {
  // CHALLENGE (a returning attendee) is shown exactly like first-time mobile
  // verification, so the screen never reveals whether an entry already exists.
  const channel: 'MOBILE' | 'EMAIL' = state.stage === 'VERIFY_EMAIL' ? 'EMAIL' : 'MOBILE';
  const destination = channel === 'MOBILE'
    ? state.participant?.mobileMasked ?? '' : state.participant?.emailMasked ?? '';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const requested = useRef<string | null>(null);

  const send = useCallback(async (resend: boolean) => {
    setSending(true); setError(null); setDevCode(null);
    try {
      const res = await api<{ sent: boolean; cooldownSeconds?: number; devCode?: string }>(
        '/api/otp/send', { method: 'POST', json: { channel } });
      setCooldown(res.cooldownSeconds ?? 60);
      if (res.devCode) setDevCode(res.devCode);
      if (resend) setNotice('A new code is on its way.');
    } catch (err) {
      if (err instanceof RequestFailed) {
        setError(err.message);
        if (err.detail.retryAfterSeconds) setCooldown(err.detail.retryAfterSeconds);
      } else setError('We could not send the code. Please try again.');
    } finally {
      setSending(false);
    }
  }, [channel]);

  useEffect(() => {
    if (requested.current === channel) return;
    requested.current = channel;
    setCode(''); setNotice(null);
    void send(false);
  }, [channel, send]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function verify() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const next = await api<State>('/api/otp/verify', { method: 'POST', json: { channel, code } });
      requested.current = null;
      onDone(next);
    } catch (err) {
      if (err instanceof RequestFailed) {
        const left = err.detail.attemptsLeft;
        setError(left !== undefined && left > 0 ? `${err.message} ${left} attempts left.` : err.message);
        if (err.detail.code === 'OTP_EXPIRED' || err.detail.code === 'OTP_ATTEMPTS') setCooldown(0);
      } else setError('We could not check that code. Please try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Title sub={<>We sent a 6-digit code to <span className="font-medium text-navy">{destination}</span></>}>
        {channel === 'MOBILE' ? 'Verify your mobile number' : 'Verify your email address'}
      </Title>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice && !error ? <Banner tone="success">{notice}</Banner> : null}
      {devCode ? <Banner>Development mode — your code is {devCode}</Banner> : null}

      <form onSubmit={(e) => { e.preventDefault(); if (code.length === 6) void verify(); }}>
        <label htmlFor="otp" className="mb-1.5 block text-[14px] font-medium text-navy">Verification code</label>
        <input id="otp" className="field otp-input" inputMode="numeric" autoComplete="one-time-code"
               maxLength={6} value={code} disabled={sending}
               aria-invalid={error ? 'true' : undefined}
               onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
               placeholder="••••••" />
        <button className="btn btn-primary mt-5" type="submit" disabled={busy || sending || code.length !== 6}>
          {busy ? <Spinner label="Checking" /> : 'Verify'}
        </button>
      </form>

      <button className="btn btn-quiet mt-3" type="button" disabled={cooldown > 0 || sending}
              onClick={() => void send(true)}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </button>

      {channel === 'EMAIL' ? (
        <p className="mt-4 text-[13px] text-navy/55">Mobile verified. One more step.</p>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- the spin
function SpinStage({ config, onResult }: { config: Config; onResult: (s: State) => void }) {
  const [rotation, setRotation] = useState(0);
  const [phase, setPhase] = useState<'READY' | 'REQUESTING' | 'SPINNING'>('READY');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<SpinResponse | null>(null);
  // One key per browser session: a retried request can never allocate twice.
  const idempotencyKey = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()));

  async function spin() {
    if (phase !== 'READY') return;           // guards double taps
    setPhase('REQUESTING'); setError(null);
    try {
      const result = await api<SpinResponse>('/api/spin', {
        method: 'POST', headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      pending.current = result;

      if (result.noInventory || !result.prize) {
        settle(result);
        return;
      }
      setPhase('SPINNING');
      setRotation((current) => rotationFor(config.prizes, result.prize!.id, current));
    } catch (err) {
      setPhase('READY');
      setError(err instanceof RequestFailed ? err.message : 'The spin did not go through. Please try again.');
    }
  }

  function settle(result: SpinResponse | null) {
    if (!result) return;
    onResult({
      stage: 'RESULT',
      participant: null,
      result: {
        prize: result.prize?.displayName ?? null,
        winnerCode: result.winnerCode,
        wonAt: result.wonAt,
        collectionStatus: result.collectionStatus ?? null,
        noInventory: result.noInventory,
      },
    });
  }

  const blocked = config.spin.state !== 'OPEN';

  return (
    <Card>
      <Title sub="One spin, one prize. Good luck.">You&rsquo;re verified</Title>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {blocked ? <Banner>{config.spin.message}</Banner> : null}

      <div className="py-4">
        <Wheel segments={config.prizes} rotation={rotation}
               onSettled={() => phase === 'SPINNING' && settle(pending.current)} />
      </div>

      <button className="btn btn-gold" onClick={() => void spin()} disabled={phase !== 'READY' || blocked}>
        {phase === 'READY' ? 'Spin now' : phase === 'REQUESTING' ? <Spinner label="Preparing your spin" />
          : 'Good luck…'}
      </button>
      <p className="mt-4 text-center text-[12.5px] text-navy/55" aria-live="polite">
        {phase === 'SPINNING' ? 'The wheel is settling on your prize.' : 'Your prize is drawn by the event system.'}
      </p>
    </Card>
  );
}

// --------------------------------------------------------------- the result
function Result({ config, state }: { config: Config; state: State }) {
  const result = state.result;

  if (!result || result.noInventory || !result.prize) {
    return (
      <Card>
        <Title sub="Every prize has been claimed. Please visit the booth — the team will look after you.">
          Thanks for joining
        </Title>
      </Card>
    );
  }

  const when = result.wonAt ? new Date(result.wonAt) : null;

  return (
    <Card className="text-center">
      <p className="text-[13px] uppercase tracking-[.18em] text-brass-dim">Congratulations</p>
      <h1 className="mt-3 font-display text-[36px] leading-[1.1] text-navy">You&rsquo;ve won a</h1>
      <p className="mt-1 font-display text-[36px] leading-[1.1] text-jade">{result.prize}</p>

      <div className="my-7 rounded-2xl border border-dashed border-navy/25 bg-mist px-4 py-5">
        <p className="text-[13px] text-navy/65">Your winner code</p>
        <p className="mt-1 font-display text-[32px] tracking-[.06em] text-navy">{result.winnerCode}</p>
      </div>

      <dl className="mx-auto max-w-[280px] space-y-1.5 text-[14px] text-navy/70">
        {state.participant?.fullName ? (
          <div className="flex justify-between"><dt>Name</dt><dd className="font-medium text-navy">
            {state.participant.fullName}</dd></div>) : null}
        {when ? (
          <div className="flex justify-between"><dt>Won at</dt><dd className="font-medium text-navy">
            {when.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>) : null}
        <div className="flex justify-between"><dt>Prize</dt><dd className="font-medium text-navy">
          {result.collectionStatus === 'COLLECTED' ? 'Collected' : 'Ready to collect'}</dd></div>
      </dl>

      <p className="mt-7 text-[15px] leading-relaxed text-navy/75">
        {result.collectionStatus === 'COLLECTED'
          ? 'This prize has already been handed over. Thank you for joining us.'
          : `Show this screen at the ${config.branding.short_name} booth to collect your prize.`}
      </p>
    </Card>
  );
}
