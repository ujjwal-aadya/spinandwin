'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestFailed } from '@/lib/client';

interface Stats {
  registrations: number; mobile_verified: number; email_verified: number; fully_verified: number;
  spins: number; winners: number; collected: number; pending_collection: number;
  prizes_remaining: number; collectionRate: number;
}
interface Inventory {
  id: string; display_name: string; initial_quantity: number; allocated: number; remaining: number;
  collected: number; weight: number; is_active: boolean;
}
interface Overview {
  event: { id: string; name: string; code: string; registrationEnabled: boolean; spinEnabled: boolean };
  stats: Stats; inventory: Inventory[]; role: 'SUPER_ADMIN' | 'EVENT_ADMIN' | 'BOOTH_OPERATOR';
}
interface Winner {
  id: string; winnerCode: string; name: string; company: string; designation: string; prize: string;
  mobile: string; email: string; wonAt: string; collectionStatus: 'PENDING' | 'COLLECTED'; collectedAt: string | null;
}
interface AuditEntry { id: string; at: string; action: string; by: string; entity: string | null;
  metadata: Record<string, unknown> }

type Tab = 'overview' | 'prizes' | 'winners' | 'controls' | 'audit';

export default function AdminDashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api<Overview>('/api/admin/stats'));
    } catch (err) {
      if (err instanceof RequestFailed && err.detail.code === 'NO_SESSION') router.replace('/admin/login');
      else setError(err instanceof RequestFailed ? err.message : 'Could not load the dashboard.');
    }
  }, [router]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch: state lands after the request resolves
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => { void refresh(); }, 30_000);   // live during the event
    return () => clearInterval(timer);
  }, [refresh]);

  if (error) return <Frame><p className="rounded-xl bg-[#FDF0ED] px-4 py-3 text-[#8A2E1C]">{error}</p></Frame>;
  if (!data) return <Frame><p className="text-navy/60">Loading…</p></Frame>;

  const tabs: [Tab, string][] = [
    ['overview', 'Overview'], ['prizes', 'Prizes'], ['winners', 'Winners'],
    ['controls', 'Controls'], ['audit', 'Audit'],
  ];

  return (
    <Frame>
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] text-navy">{data.event.name}</h1>
          <p className="text-[13px] text-navy/55">{data.event.code} · {data.role.replace('_', ' ').toLowerCase()}</p>
        </div>
        <button className="text-[13px] text-navy/60 underline"
                onClick={() => api('/api/admin/logout', { method: 'POST' }).then(() => router.replace('/admin/login'))}>
          Sign out
        </button>
      </header>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-mist-deep">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => { setTab(key); setNotice(null); }}
                  className={`whitespace-nowrap px-4 py-2.5 text-[14.5px] ${tab === key
                    ? 'border-b-2 border-brass font-semibold text-navy' : 'text-navy/55'}`}>
            {label}
          </button>
        ))}
      </nav>

      {notice ? <p role="status" className="mb-4 rounded-xl bg-[#EAF6F2] px-4 py-3 text-[14px] text-[#0E5A4C]">{notice}</p> : null}

      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'prizes' && <PrizesTab data={data} onChange={refresh} notify={setNotice} />}
      {tab === 'winners' && <WinnersTab notify={setNotice} />}
      {tab === 'controls' && <ControlsTab data={data} onChange={refresh} notify={setNotice} />}
      {tab === 'audit' && <AuditTab />}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-mist px-4 py-7">
      <div className="mx-auto w-full max-w-[1040px]">{children}</div>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: 'gold' | 'jade' }) {
  return (
    <div className="card p-4">
      <p className="text-[13px] text-navy/55">{label}</p>
      <p className={`mt-1 font-display text-[28px] ${tone === 'gold' ? 'text-brass-dim'
        : tone === 'jade' ? 'text-jade' : 'text-navy'}`}>{value}</p>
    </div>
  );
}

function OverviewTab({ data }: { data: Overview }) {
  const s = data.stats;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Registrations" value={s.registrations} />
        <Metric label="Fully verified" value={s.fully_verified} />
        <Metric label="Spins" value={s.spins} tone="gold" />
        <Metric label="Prizes collected" value={s.collected} tone="jade" />
        <Metric label="Mobile verified" value={s.mobile_verified} />
        <Metric label="Email verified" value={s.email_verified} />
        <Metric label="Awaiting collection" value={s.pending_collection} />
        <Metric label="Collection rate" value={`${s.collectionRate}%`} />
      </div>

      <h2 className="mb-3 mt-8 font-display text-[20px] text-navy">Prize inventory</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="text-left text-navy/55">
            <tr className="border-b border-mist-deep">
              {['Prize', 'Initial', 'Allocated', 'Remaining', 'Collected', 'Weight', 'Status'].map((h) => (
                <th key={h} className="px-4 py-3 font-medium">{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {data.inventory.map((p) => (
              <tr key={p.id} className="border-b border-mist last:border-0">
                <td className="px-4 py-3 font-medium text-navy">{p.display_name}</td>
                <td className="px-4 py-3">{p.initial_quantity}</td>
                <td className="px-4 py-3">{p.allocated}</td>
                <td className={`px-4 py-3 ${p.remaining === 0 ? 'text-clay' : ''}`}>{p.remaining}</td>
                <td className="px-4 py-3">{p.collected}</td>
                <td className="px-4 py-3">{p.weight}</td>
                <td className="px-4 py-3">{p.is_active ? (p.remaining > 0 ? 'Active' : 'Sold out') : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.role !== 'BOOTH_OPERATOR' ? (
        <>
          <h2 className="mb-3 mt-8 font-display text-[20px] text-navy">Exports</h2>
          <div className="flex flex-wrap gap-2">
            {['registrations', 'spins', 'winners', 'inventory', 'collections', 'audit'].map((type) => (
              <a key={type} href={`/api/admin/reports?type=${type}`}
                 className="rounded-lg border border-mist-deep bg-white px-4 py-2.5 text-[14px] text-navy hover:bg-mist">
                {type[0]!.toUpperCase() + type.slice(1)} CSV
              </a>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function PrizesTab({ data, onChange, notify }:
  { data: Overview; onChange: () => Promise<void>; notify: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readOnly = data.role === 'BOOTH_OPERATOR';

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id); setError(null);
    try {
      await api('/api/admin/prizes', { method: 'PATCH', json: { id, ...body } });
      await onChange();
      notify('Prize updated.');
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Update failed.');
    } finally { setBusy(null); }
  }

  async function adjust(id: string, form: HTMLFormElement) {
    const fd = new FormData(form);
    const adjustment = Number(fd.get('adjustment'));
    const reason = String(fd.get('reason') ?? '');
    if (!adjustment || reason.trim().length < 3) { setError('Enter an amount and a reason.'); return; }
    if (!window.confirm(`Change remaining stock by ${adjustment > 0 ? '+' : ''}${adjustment}?`)) return;
    setBusy(id); setError(null);
    try {
      const result = await api<{ previous: number; new: number }>('/api/admin/prizes/inventory', {
        method: 'POST', json: { prizeId: id, adjustment, reason, confirm: true },
      });
      form.reset();
      await onChange();
      notify(`Stock changed from ${result.previous} to ${result.new}.`);
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Adjustment failed.');
    } finally { setBusy(null); }
  }

  return (
    <>
      {error ? <p role="alert" className="mb-4 rounded-xl bg-[#FDF0ED] px-4 py-3 text-[14px] text-[#8A2E1C]">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {data.inventory.map((prize) => (
          <section key={prize.id} className="card p-5">
            <div className="flex items-baseline justify-between">
              <h3 className="font-display text-[20px] text-navy">{prize.display_name}</h3>
              <span className="text-[13px] text-navy/55">{prize.remaining} left of {prize.initial_quantity}</span>
            </div>

            {readOnly ? null : (
              <>
                <div className="mt-4 flex items-end gap-3">
                  <label className="flex-1">
                    <span className="mb-1.5 block text-[13px] text-navy/70">Weight</span>
                    <input className="field" type="number" min={0} defaultValue={prize.weight}
                           onBlur={(e) => { const v = Number(e.target.value);
                             if (v !== prize.weight) void patch(prize.id, { weight: v }); }} />
                  </label>
                  <button className="btn btn-quiet w-auto px-4" disabled={busy === prize.id}
                          onClick={() => void patch(prize.id, { isActive: !prize.is_active })}>
                    {prize.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>

                <form className="mt-4 border-t border-mist pt-4"
                      onSubmit={(e) => { e.preventDefault(); void adjust(prize.id, e.currentTarget); }}>
                  <span className="mb-2 block text-[13px] text-navy/70">Adjust stock</span>
                  <div className="flex gap-2">
                    <input name="adjustment" type="number" className="field w-24" placeholder="+10" />
                    <input name="reason" className="field flex-1" placeholder="Reason" maxLength={200} />
                  </div>
                  <button className="btn btn-quiet mt-3" type="submit" disabled={busy === prize.id}>
                    Apply adjustment
                  </button>
                </form>
              </>
            )}
          </section>
        ))}
      </div>
    </>
  );
}

function WinnersTab({ notify }: { notify: (m: string) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Winner[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      const data = await api<{ winners: Winner[] }>(`/api/admin/winners?${params.toString()}`);
      setRows(data.winners);
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Search failed.');
    } finally { setBusy(false); }
  }, [query, status]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount fetch: state lands after the request resolves
  useEffect(() => { void search(); }, [search]);

  async function collect(winner: Winner) {
    try {
      await api('/api/admin/winners/collect', { method: 'POST', json: { winnerId: winner.id } });
      notify(`${winner.prize} marked as collected for ${winner.name}.`);
      await search();
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Could not mark as collected.');
    }
  }

  return (
    <>
      <div className="card mb-4 flex flex-wrap gap-3 p-4">
        <input className="field flex-1 min-w-[220px]" value={query} placeholder="Name, company, mobile, email or winner code"
               onChange={(e) => setQuery(e.target.value)} />
        <select className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="PENDING">Not collected</option>
          <option value="COLLECTED">Collected</option>
        </select>
      </div>

      {error ? <p role="alert" className="mb-4 rounded-xl bg-[#FDF0ED] px-4 py-3 text-[14px] text-[#8A2E1C]">{error}</p> : null}
      {busy ? <p className="text-navy/55">Searching…</p> : null}
      {!busy && rows.length === 0 ? (
        <p className="card p-6 text-center text-[14px] text-navy/60">
          No winners match. Clear the filters to see everyone who has spun.
        </p>
      ) : null}

      <div className="card overflow-x-auto">
        {rows.length > 0 ? (
          <table className="w-full text-[14px]">
            <thead className="text-left text-navy/55">
              <tr className="border-b border-mist-deep">
                {['Code', 'Name', 'Company', 'Prize', 'Mobile', 'Won', 'Status', ''].map((h) => (
                  <th key={h} className="px-3 py-3 font-medium">{h}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-mist last:border-0">
                  <td className="px-3 py-3 font-medium text-navy">{w.winnerCode}</td>
                  <td className="px-3 py-3">{w.name}</td>
                  <td className="px-3 py-3 text-navy/70">{w.company}</td>
                  <td className="px-3 py-3">{w.prize}</td>
                  <td className="px-3 py-3 text-navy/70">{w.mobile}</td>
                  <td className="px-3 py-3 text-navy/70">{new Date(w.wonAt).toLocaleString('en-PH', { timeStyle: 'short', dateStyle: 'short' })}</td>
                  <td className={`px-3 py-3 ${w.collectionStatus === 'COLLECTED' ? 'text-jade' : ''}`}>
                    {w.collectionStatus === 'COLLECTED' ? 'Collected' : 'Pending'}</td>
                  <td className="px-3 py-3">
                    {w.collectionStatus === 'PENDING' ? (
                      <button className="rounded-lg bg-navy px-3 py-2 text-[13px] text-white"
                              onClick={() => void collect(w)}>Mark collected</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  );
}

function ControlsTab({ data, onChange, notify }:
  { data: Overview; onChange: () => Promise<void>; notify: (m: string) => void }) {
  const [error, setError] = useState<string | null>(null);

  async function toggle(field: 'registrationEnabled' | 'spinEnabled', value: boolean) {
    const reason = window.prompt(`Reason for ${value ? 'enabling' : 'pausing'} this?`);
    if (!reason || reason.trim().length < 3) return;
    setError(null);
    try {
      await api('/api/admin/event', { method: 'PATCH', json: { [field]: value, reason } });
      await onChange();
      notify('Event updated.');
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Update failed.');
    }
  }

  if (data.role === 'BOOTH_OPERATOR') {
    return <p className="card p-6 text-[14px] text-navy/60">Event controls are limited to event administrators.</p>;
  }

  return (
    <>
      {error ? <p role="alert" className="mb-4 rounded-xl bg-[#FDF0ED] px-4 py-3 text-[14px] text-[#8A2E1C]">{error}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card p-5">
          <h3 className="font-display text-[20px] text-navy">Registration</h3>
          <p className="mt-1 text-[14px] text-navy/60">
            {data.event.registrationEnabled ? 'Attendees can register now.' : 'Registration is paused.'}
          </p>
          <button className="btn btn-quiet mt-4"
                  onClick={() => void toggle('registrationEnabled', !data.event.registrationEnabled)}>
            {data.event.registrationEnabled ? 'Pause registration' : 'Resume registration'}
          </button>
        </section>
        <section className="card p-5">
          <h3 className="font-display text-[20px] text-navy">Spinning</h3>
          <p className="mt-1 text-[14px] text-navy/60">
            {data.event.spinEnabled ? 'Verified attendees can spin.' : 'Spinning is paused.'}
          </p>
          <button className="btn btn-quiet mt-4"
                  onClick={() => void toggle('spinEnabled', !data.event.spinEnabled)}>
            {data.event.spinEnabled ? 'Pause spinning' : 'Resume spinning'}
          </button>
        </section>
      </div>
      <p className="mt-5 text-[13px] leading-relaxed text-navy/55">
        Pausing takes effect immediately for new requests. Spins already allocated keep their prize, and every
        change here is written to the audit trail with the reason you enter.
      </p>
    </>
  );
}

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ entries: AuditEntry[] }>('/api/admin/audit?limit=200')
      .then((d) => setEntries(d.entries))
      .catch((err) => setError(err instanceof RequestFailed ? err.message : 'Could not load the audit trail.'));
  }, []);

  if (error) return <p className="rounded-xl bg-[#FDF0ED] px-4 py-3 text-[14px] text-[#8A2E1C]">{error}</p>;

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead className="text-left text-navy/55">
          <tr className="border-b border-mist-deep">
            {['Time', 'Action', 'By', 'Entity', 'Detail'].map((h) => (
              <th key={h} className="px-3 py-3 font-medium">{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-mist last:border-0">
              <td className="whitespace-nowrap px-3 py-2.5 text-navy/70">
                {new Date(e.at).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'medium' })}</td>
              <td className="px-3 py-2.5 font-medium text-navy">{e.action.replaceAll('_', ' ').toLowerCase()}</td>
              <td className="px-3 py-2.5">{e.by}</td>
              <td className="px-3 py-2.5 text-navy/70">{e.entity ?? '—'}</td>
              <td className="px-3 py-2.5 text-navy/60">
                {Object.keys(e.metadata ?? {}).length ? JSON.stringify(e.metadata) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
