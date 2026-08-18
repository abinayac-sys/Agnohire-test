import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { logger } from '../config/logger.js';
import { razorpayProvider } from '../services/billing/razorpayProvider.js';
import { processWebhookEvent } from '../services/billing/billingService.js';

/**
 * POST /api/billing/webhook — Razorpay webhook receiver.
 *
 * MUST be mounted with express.raw({ type: 'application/json' }) BEFORE the
 * global JSON parser (see app.ts) — signature verification requires the exact
 * request bytes. Responds 2xx quickly; processing is idempotent via
 * PaymentEvent.eventId.
 */
export async function razorpayWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-razorpay-signature'];
  const raw = req.body as Buffer;

  if (typeof signature !== 'string' || !Buffer.isBuffer(raw)) {
    res.status(400).json({ success: false, error: { code: 'BAD_WEBHOOK', message: 'Missing signature or raw body' } });
    return;
  }

  if (!razorpayProvider.verifyWebhookSignature(raw, signature)) {
    logger.warn('Razorpay webhook signature verification FAILED');
    res.status(400).json({ success: false, error: { code: 'BAD_SIGNATURE', message: 'Invalid webhook signature' } });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payload: any;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Unparseable payload' } });
    return;
  }

  // Razorpay sends x-razorpay-event-id; fall back to a payload hash.
  const eventId =
    (req.headers['x-razorpay-event-id'] as string | undefined) ??
    crypto.createHash('sha256').update(raw).digest('hex');
  const eventType = payload?.event ?? 'unknown';

  // Ack fast, process inline (idempotent) — Razorpay retries on non-2xx.
  try {
    await processWebhookEvent(eventId, eventType, payload);
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Webhook processing failed', { eventId, eventType, err: (err as Error).message });
    // 500 → Razorpay retries; handler is idempotent so replays are safe.
    res.status(500).json({ success: false });
  }
}
