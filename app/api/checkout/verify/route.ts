import { confirmPurchase } from '@/lib/checkout';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { order_id?: string; payment_id?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { order_id, payment_id, signature } = body;
  if (!order_id || !payment_id || !signature) {
    return Response.json({ ok: false, error: 'Missing fields' }, { status: 400 });
  }
  const ok = confirmPurchase(order_id, payment_id, signature);
  return Response.json({ ok });
}
