'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestFailed } from '@/lib/client';

export default function AdminLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    setBusy(true); setError(null);
    try {
      const result = await api<{ role: string }>('/api/admin/login', {
        method: 'POST',
        json: { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') },
      });
      router.replace(result.role === 'BOOTH_OPERATOR' ? '/booth' : '/admin');
      router.refresh();
    } catch (err) {
      setError(err instanceof RequestFailed ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="stage flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-6 text-center font-display text-[30px] text-white">Event administration</h1>
        <div className="card p-7">
          {error ? (
            <p role="alert" className="mb-4 rounded-xl border border-[#F1C9BF] bg-[#FDF0ED] px-4 py-3 text-[14px] text-[#8A2E1C]">
              {error}
            </p>
          ) : null}
          <form onSubmit={(e) => { e.preventDefault(); void submit(new FormData(e.currentTarget)); }}>
            <label htmlFor="email" className="mb-1.5 block text-[14px] font-medium text-navy">Email</label>
            <input id="email" name="email" type="email" autoComplete="username" required className="field mb-4" />
            <label htmlFor="password" className="mb-1.5 block text-[14px] font-medium text-navy">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required
                   className="field mb-6" />
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="mt-6 text-center text-[12.5px] text-white/55">Attendee entries use a separate sign-in.</p>
      </div>
    </main>
  );
}
