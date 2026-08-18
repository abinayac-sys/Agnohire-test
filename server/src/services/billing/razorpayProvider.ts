import crypto from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Provider abstraction over Razorpay Subscriptions. Controllers/services only
 * talk to this interface, so tests can inject a stub and the platform could
 * swap providers later. The `razorpay` SDK is loaded lazily so the app boots
 * without the dependency/keys in environments where billing is disabled.
 */

export interface ProviderSubscription {
  id: string;
  status: string;
  shortUrl: string | null;
  currentStart: Date | null;
  currentEnd: Date | null;
}

export interface ProviderAddon {
  id: string;
}

export interface ProviderPaymentLink {
  id: string;
  shortUrl: string;
}

export interface PaymentProvider {
  createSubscription(opts: {
    razorpayPlanId: string;
    totalCount: number;
    notes: Record<string, string>;
  }): Promise<ProviderSubscription>;
  cancelSubscription(razorpaySubscriptionId: string, atCycleEnd: boolean): Promise<void>;
  fetchSubscription(razorpaySubscriptionId: string): Promise<ProviderSubscription>;
  /**
   * Attaches a one-time line item to the subscription's NEXT invoice —
   * Razorpay's mechanism for a variable recurring charge (there is no native
   * "recurring addon" primitive; re-attaching a fresh addon each cycle, right
   * before that cycle's renewal, is Razorpay's own documented pattern for
   * this). The customer's existing mandate (set up once at Checkout) covers
   * it — this never touches card/payment details directly.
   */
  createAddon(opts: {
    razorpaySubscriptionId: string;
    name: string;
    amount: number;
    currency: string;
  }): Promise<ProviderAddon>;
  /**
   * A standalone, immediately-payable Payment Link — used for a mid-cycle
   * prorated add-on charge, as opposed to createAddon() which only ever
   * attaches to the customer's NEXT subscription invoice. The customer must
   * open the link and confirm payment themselves; nothing here silently
   * charges a saved card.
   */
  createPaymentLink(opts: {
    amount: number;
    currency: string;
    description: string;
    customerName: string;
    customerEmail: string;
    notes: Record<string, string>;
  }): Promise<ProviderPaymentLink>;
  verifyCheckoutSignature(paymentId: string, subscriptionId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean;
}

function hmacSha256(data: string | Buffer, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
async function razorpay(): Promise<any> {
  if (!client) {
    const { default: Razorpay } = await import('razorpay');
    client = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });
  }
  return client;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProviderSub(sub: any): ProviderSubscription {
  return {
    id: sub.id,
    status: sub.status,
    shortUrl: sub.short_url ?? null,
    currentStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
    currentEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
  };
}

export const razorpayProvider: PaymentProvider = {
  async createSubscription({ razorpayPlanId, totalCount, notes }) {
    const rp = await razorpay();
    const sub = await rp.subscriptions.create({
      plan_id: razorpayPlanId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: 1,
      notes,
    });
    return toProviderSub(sub);
  },

  async cancelSubscription(id, atCycleEnd) {
    const rp = await razorpay();
    await rp.subscriptions.cancel(id, atCycleEnd);
  },

  async fetchSubscription(id) {
    const rp = await razorpay();
    return toProviderSub(await rp.subscriptions.fetch(id));
  },

  /**
   * Razorpay amounts are in the smallest currency unit (paise for INR) — the
   * caller passes rupees, this converts. `quantity: 1` since the caller
   * already computed the total amount for the cycle.
   */
  async createAddon({ razorpaySubscriptionId, name, amount, currency }) {
    const rp = await razorpay();
    const addon = await rp.subscriptions.createAddon(razorpaySubscriptionId, {
      item: { name, amount: Math.round(amount * 100), currency },
      quantity: 1,
    });
    return { id: addon.id };
  },

  async createPaymentLink({ amount, currency, description, customerName, customerEmail, notes }) {
    const rp = await razorpay();
    const link = await rp.paymentLink.create({
      amount: Math.round(amount * 100),
      currency,
      description,
      customer: { name: customerName, email: customerEmail },
      notify: { email: true, sms: false },
      notes,
    });
    return { id: link.id, shortUrl: link.short_url };
  },

  /** HMAC_SHA256(payment_id + "|" + subscription_id, KEY_SECRET) === signature */
  verifyCheckoutSignature(paymentId, subscriptionId, signature) {
    if (!env.razorpay.keySecret) return false;
    const expected = hmacSha256(`${paymentId}|${subscriptionId}`, env.razorpay.keySecret);
    return safeEqual(expected, signature);
  },

  /** HMAC_SHA256(rawBody, WEBHOOK_SECRET) === x-razorpay-signature header */
  verifyWebhookSignature(rawBody, signature) {
    if (!env.razorpay.webhookSecret) return false;
    const expected = hmacSha256(rawBody, env.razorpay.webhookSecret);
    return safeEqual(expected, signature);
  },
};
