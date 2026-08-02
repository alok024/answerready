import { createOrder, verifyPaymentSignature, mockSignature, RAZORPAY_MOCK } from './razorpay';

export type PlanKind = 'one-time' | 'sub';

export interface Plan {
  amount: number;
  currency: string;
  label: string;
  kind: PlanKind;
}

export const PLANS: Record<string, Plan> = {
  single_kit: { amount: 1900, currency: 'USD', label: '$19 one-time - single-site kit', kind: 'one-time' },
  starter_month: { amount: 2900, currency: 'USD', label: '$29/mo - 25 kits', kind: 'sub' },
  pro_month: { amount: 7900, currency: 'USD', label: '$79/mo - 150 kits + bulk', kind: 'sub' },
};

export function listPlans() {
  return Object.entries(PLANS).map(([id, p]) => ({ id, ...p }));
}

export async function createCheckoutOrder(planId: string) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);

  const order = await createOrder(plan.amount, plan.currency, { planId });
  const base = { ...order, planId, label: plan.label };

  if (order.mock) {
    const paymentId = 'pay_mock_' + order.order_id.slice(-8);
    const signature = mockSignature(order.order_id, paymentId);
    return { ...base, mock_payment: { payment_id: paymentId, signature } };
  }
  return base;
}

export function confirmPurchase(order_id: string, payment_id: string, signature: string): boolean {
  return verifyPaymentSignature(order_id, payment_id, signature);
}

export { RAZORPAY_MOCK };
