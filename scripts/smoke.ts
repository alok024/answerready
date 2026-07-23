import { generateKit } from '../lib/generate';
import { createCheckoutOrder } from '../lib/checkout';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}

async function main() {
  const k = await generateKit({ mode: 'topic', value: 'best running shoes for flat feet' });

  assert(k.faqs.length >= 4, `expected >=4 faqs, got ${k.faqs.length}`);

  const j = JSON.parse(k.jsonld);
  assert(j['@type'] === 'FAQPage', `expected FAQPage, got ${j['@type']}`);
  assert(
    j.mainEntity.length === k.faqs.length,
    `jsonld mainEntity (${j.mainEntity.length}) != faqs (${k.faqs.length})`,
  );

  assert(k.llmstxt.includes('FAQ'), 'llmstxt missing FAQ section');
  assert(k.snippets.length > 0, 'expected at least one snippet');

  const order = await createCheckoutOrder('single_kit');
  assert(order.order_id, 'order missing order_id');
  assert((order as { mock_payment?: unknown }).mock_payment, 'mock order missing mock_payment');

  console.log('SMOKE-OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
