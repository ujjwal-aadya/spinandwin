'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestFailed } from '@/lib/client';

interface Winner {
  id: string; winnerCode: string; name: string; company: string; prize: string;
  mobile: string; collectionStatus: 'PENDING' | 'COLLECTED'; collectedAt: string | null;
}

export default function BoothPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Winner[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ fullName: string } | null>(null);

  useEffect(() => {
    api<{ fullName: string }>('/api/admin/me')
      .then(setMe)
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const search = useCallback(async () => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const data = await api<{ winners: Winner[] }>(`/api/admin/winners?q=${encodeURIComponent(query)}&limit=20`);
      setResults(data.winners);
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  }, [query]);

  async function collect(winner: Winner) {
    setError(null); setMessage(null);
    try {
      await api('/api/admin/winners/collect', { method: 'POST', json: { winnerId: winner.id } });
      setMessage(`${winner.prize} marked as collected for ${winner.name}.`);
      await search();
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Could not mark as collected.');
    }
  }

  return (
    <main className="min-h-dvh bg-mist px-4 py-6">
      <div className="mx-auto w-full max-w-[520px]">
        <header className="mb-5 flex items-center justify-between">
          <h1 className="font-display text-[26px] text-navy">Prize collection</h1>
          <button className="text-[13px] text-navy/60 underline"
                  onClick={() => api('/api/admin/logout', { method: 'POST' }).then(() => router.replace('/admin/login'))}>
            Sign out
          </button>
        </header>
        {me ? <p className="mb-4 text-[13px] text-navy/60">Signed in as {me.fullName}</p> : null}

        <div className="card p-5">
          <label htmlFor="q" className="mb-1.5 block text-[14px] font-medium text-navy">
            Winner code or mobile number
          </label>
          <form onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input id="q" className="field mb-3" value={query} autoCapitalize="characters"
                   placeholder="TOAP-8F4K72" onChange={(e) => setQuery(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={busy || query.trim().length < 3}>
              {busy ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>

        {error ? <p role="alert" className="mt-4 rounded-xl bg-[#FDF0ED] px-4 py-3 text-[14px] text-[#8A2E1C]">{error}</p> : null}
        {message ? <p role="status" className="mt-4 rounded-xl bg-[#EAF6F2] px-4 py-3 text-[14px] text-[#0E5A4C]">{message}</p> : null}

        {results?.length === 0 ? (
          <p className="mt-6 text-center text-[14px] text-navy/60">
            No winner matches that. Check the code with the attendee and search again.
          </p>
        ) : null}

        {results?.map((winner) => (
          <article key={winner.id} className="card mt-4 p-5">
            <p className="font-display text-[22px] text-navy">{winner.prize}</p>
            <p className="mt-1 text-[15px] text-navy">{winner.name}</p>
            <p className="text-[14px] text-navy/60">{winner.company}</p>
            <dl className="mt-3 space-y-1 text-[13.5px] text-navy/70">
              <div className="flex justify-between"><dt>Winner code</dt><dd className="font-medium text-navy">{winner.winnerCode}</dd></div>
              <div className="flex justify-between"><dt>Mobile</dt><dd>{winner.mobile}</dd></div>
              <div className="flex justify-between"><dt>Status</dt>
                <dd className={winner.collectionStatus === 'COLLECTED' ? 'text-jade' : 'text-navy'}>
                  {winner.collectionStatus === 'COLLECTED' ? 'Collected' : 'Not collected'}
                </dd></div>
            </dl>
            {winner.collectionStatus === 'PENDING' ? (
              <button className="btn btn-gold mt-4" onClick={() => void collect(winner)}>Mark as collected</button>
            ) : (
              <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-center text-[13.5px] text-navy/70">
                Handed over{winner.collectedAt ? ` on ${new Date(winner.collectedAt).toLocaleString('en-PH')}` : ''}.
              </p>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
