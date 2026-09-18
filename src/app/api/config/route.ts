import { activeEvent, eventSettings, registrationWindow, spinWindow, windowMessage } from '@/lib/event';
import { publicPrizes } from '@/lib/state';
import { ok, fail, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Public branding + wheel configuration. No inventory numbers, no personal data. */
export async function GET() {
  try {
    const event = await activeEvent();
    if (!event) return fail('No event is running right now.', 404, 'NO_EVENT');

    const [settings, prizes] = await Promise.all([eventSettings(event.id), publicPrizes(event.id)]);
    const regState = registrationWindow(event);
    const spinState = spinWindow(event);

    return ok({
      event: { name: event.name, venue: event.venue, date: event.event_date },
      branding: settings.branding,
      privacyNotice: settings.privacy_notice.text,
      consentText: settings.consent_text.text,
      formFields: settings.form_fields,
      prizes,
      registration: { state: regState, message: windowMessage(regState) },
      spin: { state: spinState, message: windowMessage(spinState) },
    });
  } catch (error) {
    return serverError('config', error);
  }
}
