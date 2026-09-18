export interface DeliveryResult { ok: boolean; providerRef?: string; error?: string }

export interface SmsProvider {
  readonly name: string;
  send(to: string, message: string): Promise<DeliveryResult>;
}

export interface EmailProvider {
  readonly name: string;
  send(to: string, subject: string, html: string, text: string): Promise<DeliveryResult>;
}
