import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

/**
 * Pure unit tests for the Razorpay signature math (checkout + webhook).
 * Recomputes the expected HMACs with known secrets and asserts the provider's
 * verification agrees. No server or DB required — safe in the integration run.
 */

const KEY_SECRET = 'test_key_secret_123';
const WEBHOOK_SECRET = 'test_webhook_secret_456';

// env.ts requires these at import time; harmless dummies for a pure unit test.
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 1).toString('base64');

process.env.RAZORPAY_KEY_ID = 'rzp_test_dummy';
process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

describe('razorpay signature verification', () => {
  it('accepts a valid checkout signature and rejects a forged one', async () => {
    const { razorpayProvider } = await import('../src/services/billing/razorpayProvider.js');
    const paymentId = 'pay_ABC123';
    const subscriptionId = 'sub_XYZ789';
    const valid = crypto
      .createHmac('sha256', KEY_SECRET)
      .update(`${paymentId}|${subscriptionId}`)
      .digest('hex');

    expect(razorpayProvider.verifyCheckoutSignature(paymentId, subscriptionId, valid)).toBe(true);
    expect(razorpayProvider.verifyCheckoutSignature(paymentId, subscriptionId, 'deadbeef')).toBe(false);
    expect(razorpayProvider.verifyCheckoutSignature('pay_OTHER', subscriptionId, valid)).toBe(false);
  });

  it('accepts a valid webhook signature over the raw body and rejects tampering', async () => {
    const { razorpayProvider } = await import('../src/services/billing/razorpayProvider.js');
    const rawBody = Buffer.from(
      JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_1' } } } }),
    );
    const valid = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

    expect(razorpayProvider.verifyWebhookSignature(rawBody, valid)).toBe(true);

    const tampered = Buffer.concat([rawBody, Buffer.from(' ')]);
    expect(razorpayProvider.verifyWebhookSignature(tampered, valid)).toBe(false);
    expect(razorpayProvider.verifyWebhookSignature(rawBody, valid.slice(0, -2) + '00')).toBe(false);
  });
});
