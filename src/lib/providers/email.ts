import { env } from '../env';
import type { EmailProvider, DeliveryResult } from './types';

/** Resend — https://resend.com */
class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  async send(to: string, subject: string, html: string, text: string): Promise<DeliveryResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) return { ok: false, error: 'RESEND_API_KEY / EMAIL_FROM is not configured' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, error: `Resend responded ${res.status}` };
      const payload = (await res.json().catch(() => ({}))) as { id?: string };
      return { ok: true, providerRef: payload.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Email request failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  async send(to: string, subject: string, _html: string, text: string): Promise<DeliveryResult> {
    console.info(JSON.stringify({ level: 'info', channel: 'email-dev', to, subject, text }));
    return { ok: true, providerRef: 'dev' };
  }
}

export function emailProvider(): EmailProvider {
  if (env.otpDevMode) return new ConsoleEmailProvider();
  switch (env.emailProvider) {
    case 'resend': return new ResendProvider();
    case 'console': return new ConsoleEmailProvider();
    default: throw new Error(`Unknown EMAIL_PROVIDER: ${env.emailProvider}`);
  }
}

export function otpEmailTemplate(eventName: string, code: string, ttlMinutes: number) {
  const text = `Your ${eventName} verification code is ${code}. It expires in ${ttlMinutes} minutes. If you did not request this, ignore this email.`;
  const html = `<!doctype html><html><body style="margin:0;background:#EEF2F6;font-family:'Public Sans',Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0F2742;padding:24px 28px;color:#fff;font-size:15px;letter-spacing:.02em">${escapeHtml(eventName)}</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px;font-size:16px;color:#0F2742">Here is your verification code.</p>
<p style="margin:0 0 20px;font-size:38px;font-weight:700;letter-spacing:.24em;color:#0F2742">${escapeHtml(code)}</p>
<p style="margin:0;font-size:14px;color:#4A5B6E">The code expires in ${ttlMinutes} minutes and can be used once. If you did not request it, you can ignore this email.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
