// Standalone Razorpay checkout helper — distilled from Vachix's proven pattern
// (backend/src/modules/payment/payment.service.ts). Framework-agnostic (Node runtime),
// meant to be copied into each product's server code (Next.js route handlers / API).
//
// Provides: createOrder (intent embedded in notes), verifyPaymentSignature (client callback),
// verifyWebhookSignature (raw body). Falls back to a keyless MOCK mode for local dev so the
// full checkout flow runs with zero credentials. Real keys go in env; needs logged in BLOCKERS.md.

import crypto from 'crypto';

const KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

const KEYS_MISSING = !KEY_ID || !KEY_SECRET;

// Mock is only allowed outside production, or with an explicit opt-in — otherwise a prod
// deploy with no keys configured would silently hand out fake "paid" orders.
function mockAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.RAZORPAY_ALLOW_MOCK === 'true';
}

// Mock mode when no live secret is present and mock is allowed — local dev + tests run the
// whole flow without keys. Production with no keys and no opt-in falls through to
// checkoutUnavailableReason() instead.
export const RAZORPAY_MOCK = KEYS_MISSING && mockAllowed();

// Non-null only in production when keys are absent and mock hasn't been explicitly opted
// into. Callers use this to fail closed instead of letting createOrder mock a "paid" order.
export function checkoutUnavailableReason(): string | null {
  if (KEYS_MISSING && !mockAllowed()) {
    return 'Checkout is not configured: Razorpay keys are missing in production';
  }
  return null;
}

export interface CreatedOrder {
  order_id: string;
  amount: number; // in the smallest currency unit (paise/cents)
  currency: string;
  key: string; // publishable key_id for the browser checkout
  mock: boolean;
}

// Create an order. `notes` carry the purchase intent so the webhook/verify can reconstruct
// what was bought without a DB lookup (Vachix pattern). amount is in the smallest unit.
export async function createOrder(
  amount: number,
  currency: string,
  notes: Record<string, string>,
): Promise<CreatedOrder> {
  const unavailable = checkoutUnavailableReason();
  if (unavailable) throw new Error(unavailable);

  if (RAZORPAY_MOCK) {
    // Deterministic-ish mock id; no network. Signature check below understands mock orders.
    const id = 'order_mock_' + crypto.randomBytes(8).toString('hex');
    return { order_id: id, amount, currency, key: 'rzp_test_mock', mock: true };
  }

  // Lazy import so the module works even when the SDK isn't installed in mock-only setups.
  // Cast to any: the real path is exercised only with live keys, and this avoids coupling the
  // build to the razorpay SDK's shipped types.
  const Razorpay = ((await import('razorpay')) as any).default;
  const rzp = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  const order = await rzp.orders.create({ amount, currency, notes });
  return { order_id: order.id, amount: Number(order.amount), currency: order.currency, key: KEY_ID, mock: false };
}

// Constant-time hex compare — plain === leaks timing on HMAC checks (Vachix hexDigestsEqual).
function hexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Verify the client checkout callback: HMAC-SHA256 over `${orderId}|${paymentId}` with the key secret.
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (RAZORPAY_MOCK) {
    // In mock mode, accept the mock signature the mock checkout produced (see mockSignature()).
    return signature === mockSignature(orderId, paymentId);
  }
  const expected = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return hexEqual(expected, signature);
}

// Verify a webhook: HMAC-SHA256 over the RAW request body with the webhook secret.
// Register the webhook route with a raw-body parser BEFORE any JSON body parser.
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (RAZORPAY_MOCK) return true; // mock: trust local webhook simulator
  if (!WEBHOOK_SECRET) return false; // no secret and not in mock mode — fail closed, not open
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  return hexEqual(expected, signature);
}

// The signature a mock checkout returns so verifyPaymentSignature can accept it in dev.
export function mockSignature(orderId: string, paymentId: string): string {
  return crypto.createHmac('sha256', 'mock_secret').update(`${orderId}|${paymentId}`).digest('hex');
}
