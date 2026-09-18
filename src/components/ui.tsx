'use client';

import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card p-6 sm:p-8 ${className}`}>{children}</div>;
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-[28px] leading-[1.15] text-navy">{children}</h1>
      {sub ? <p className="mt-2 text-[15px] leading-relaxed text-navy/70">{sub}</p> : null}
    </header>
  );
}

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const tones = {
    info: 'bg-mist text-navy border-mist-deep',
    error: 'bg-[#FDF0ED] text-[#8A2E1C] border-[#F1C9BF]',
    success: 'bg-[#EAF6F2] text-[#0E5A4C] border-[#BFE3D9]',
  } as const;
  return (
    <p role={tone === 'error' ? 'alert' : 'status'}
       className={`mb-4 rounded-xl border px-4 py-3 text-[14px] leading-snug ${tones[tone]}`}>
      {children}
    </p>
  );
}

export function Field({
  label, name, hint, error, ...props
}: { label: string; name: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(' ');
  return (
    <div className="mb-4">
      <label htmlFor={name} className="mb-1.5 block text-[14px] font-medium text-navy">{label}</label>
      <input id={name} name={name} className="field" aria-invalid={error ? 'true' : undefined}
             aria-describedby={describedBy || undefined} {...props} />
      {hint && !error ? <p id={`${name}-hint`} className="mt-1.5 text-[13px] text-navy/55">{hint}</p> : null}
      {error ? <p id={`${name}-error`} className="mt-1.5 text-[13px] text-clay">{error}</p> : null}
    </div>
  );
}

export function Spinner({ label = 'Working' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="animate-spin">
        <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
        <path d="M16 9a7 7 0 0 0-7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </span>
  );
}

export function Footer({ partner }: { partner?: string }) {
  return (
    <p className="mt-6 text-center text-[12.5px] text-white/55">
      {partner ?? 'Powered by Credence Analytics'}
    </p>
  );
}
