/**
 * Razorpay plan-id bootstrap.
 *
 * The Plan catalogue itself (code/name/price/currency/limits) is already
 * seeded into the database by prisma/seed.ts — that's the single source of
 * truth for pricing. This script never creates, renames, or re-prices a
 * Plan row; it only reads what's already there and, for each active paid
 * plan still missing a Razorpay mapping, creates a matching Razorpay Plan
 * and saves its id onto razorpayPlanIdMonthly/razorpayPlanIdYearly.
 *
 * Usage:
 *   CREATE_RAZORPAY_PLANS=true npm run bootstrap:plans --workspace server
 *     → requires RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET
 *
 * Safe to re-run: only fills in whichever of razorpayPlanIdMonthly/Yearly is
 * still null for a given plan; already-mapped intervals are left untouched
 * (Razorpay plans are immutable on price once created, so there is nothing
 * to "sync" for one that already exists).
 */
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

async function main(): Promise<void> {
  if (process.env.CREATE_RAZORPAY_PLANS !== 'true') {
    console.log('CREATE_RAZORPAY_PLANS is not "true" — nothing to do.');
    console.log('Set it to create/sync Razorpay plan mappings from the Plan rows already in the database.');
    return;
  }
  if (!env.razorpay.enabled) throw new Error('RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET required');
  const { default: Razorpay } = await import('razorpay');
  const rp = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret });

  const plans = await prisma.plan.findMany({ where: { isActive: true } });

  for (const p of plans) {
    const monthlyAmount = p.priceMonthly != null ? Number(p.priceMonthly) : null;
    const yearlyAmount = p.priceYearly != null ? Number(p.priceYearly) : null;

    // A plan with no price on either interval (FREE, or a legacy/custom plan
    // billed outside Razorpay) has nothing to map — there's no subscription
    // to create for it.
    if (!monthlyAmount && !yearlyAmount) {
      console.log(`Skipping ${p.code} — no price set on either interval.`);
      continue;
    }

    let razorpayPlanIdMonthly = p.razorpayPlanIdMonthly;
    let razorpayPlanIdYearly = p.razorpayPlanIdYearly;

    if (monthlyAmount && !razorpayPlanIdMonthly) {
      const created = await rp.plans.create({
        period: 'monthly',
        interval: 1,
        item: { name: `AgnoHire ${p.name} (Monthly)`, amount: Math.round(monthlyAmount * 100), currency: p.currency },
      });
      razorpayPlanIdMonthly = created.id;
      console.log(`Created Razorpay plan ${created.id} for ${p.code} monthly (${p.currency} ${monthlyAmount})`);
    }
    if (yearlyAmount && !razorpayPlanIdYearly) {
      const created = await rp.plans.create({
        period: 'yearly',
        interval: 1,
        item: { name: `AgnoHire ${p.name} (Yearly)`, amount: Math.round(yearlyAmount * 100), currency: p.currency },
      });
      razorpayPlanIdYearly = created.id;
      console.log(`Created Razorpay plan ${created.id} for ${p.code} yearly (${p.currency} ${yearlyAmount})`);
    }

    if (razorpayPlanIdMonthly !== p.razorpayPlanIdMonthly || razorpayPlanIdYearly !== p.razorpayPlanIdYearly) {
      await prisma.plan.update({ where: { id: p.id }, data: { razorpayPlanIdMonthly, razorpayPlanIdYearly } });
      console.log(`Saved Razorpay plan mapping for ${p.code}`);
    } else {
      console.log(`${p.code} already fully mapped — nothing to do.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
