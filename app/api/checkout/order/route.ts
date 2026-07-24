import { createCheckoutOrder } from '@/lib/checkout';
import { checkoutUnavailableReason } from '@/lib/razorpay';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const unavailable = checkoutUnavailableReason();
  if (unavailable) return Response.json({ error: unavailable }, { status: 503 });

  let body: { planId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const planId = (body.planId || '').trim();
  if (!planId) return Response.json({ error: 'Missing planId' }, { status: 400 });

  try {
    const result = await createCheckoutOrder(planId);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order failed';
    return Response.json({ error: message }, { status: 400 });
  }
}
