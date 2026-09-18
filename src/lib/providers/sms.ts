import { env } from '../env';
import type { SmsProvider, DeliveryResult } from './types';

/** Semaphore — https://semaphore.co (Philippine SMS gateway). */
class SemaphoreProvider implements SmsProvider {
  readonly name = 'semaphore';

  async send(to: string, message: string): Promise<DeliveryResult> {
    const apiKey = process.env.SEMAPHORE_API_KEY;
    if (!apiKey) return { ok: false, error: 'SEMAPHORE_API_KEY is not configured' };

    const body = new URLSearchParams({
      apikey: apiKey,
      // Semaphore expects the local 09XXXXXXXXX form.
      number: to.replace(/^\+63/, '0'),
      message,
    });
    const sender = process.env.SEMAPHORE_SENDER_NAME;
    if (sender) body.set('sendername', sender);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: `Semaphore responded ${res.status}` };
      const ref = Array.isArray(payload) && payload[0] && typeof payload[0] === 'object'
        ? String((payload[0] as Record<string, unknown>).message_id ?? '')
        : undefined;
      return { ok: true, providerRef: ref };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'SMS request failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Development/test transport: prints the code to the server log, sends nothing. */
class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  async send(to: string, message: string): Promise<DeliveryResult> {
    console.info(JSON.stringify({ level: 'info', channel: 'sms-dev', to, message }));
    return { ok: true, providerRef: 'dev' };
  }
}

export function smsProvider(): SmsProvider {
  if (env.otpDevMode) return new ConsoleSmsProvider();
  switch (env.smsProvider) {
    case 'semaphore': return new SemaphoreProvider();
    case 'console': return new ConsoleSmsProvider();
    default: throw new Error(`Unknown SMS_PROVIDER: ${env.smsProvider}`);
  }
}
