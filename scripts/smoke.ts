import { generateKit } from '../lib/generate';
import { createCheckoutOrder } from '../lib/checkout';
import { capText, MAX_INPUT_CHARS } from '../lib/limits';
import { createMemoryRateLimitStore } from '../lib/store/rate-limit';
import { checkoutUnavailableReason } from '../lib/razorpay';
import { GROQ_MOCK } from '../lib/groq';

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

  // llms.txt (llmstxt.org) spec: H1 title, blockquote summary, markdown link list.
  const llmsLines = k.llmstxt.split('\n');
  assert(/^# /.test(llmsLines[0] ?? ''), 'llms.txt must start with an H1 line (# Title)');
  assert(/^> /m.test(k.llmstxt), 'llms.txt missing a blockquote summary line (> ...)');
  assert(/^- \[/m.test(k.llmstxt), 'llms.txt missing a markdown link list line (- [...)');

  assert(k.snippets.length > 0, 'expected at least one snippet');

  const order = await createCheckoutOrder('single_kit');
  assert(order.order_id, 'order missing order_id');
  assert((order as { mock_payment?: unknown }).mock_payment, 'mock order missing mock_payment');

  // Input caps: an oversized value must be hard-capped before it reaches the LLM prompt,
  // and the generator must still resolve to a usable kit rather than throw.
  assert(capText('x'.repeat(10000)).length <= MAX_INPUT_CHARS, 'capText did not enforce MAX_INPUT_CHARS');
  const capped = await generateKit({ mode: 'topic', value: 'a'.repeat(5000) });
  assert(capped.faqs.length >= 4, `expected >=4 faqs for oversized input, got ${capped.faqs.length}`);

  // Rate limit: sliding-window store trips only after maxHits within the window.
  const maxHits = 2;
  const store = createMemoryRateLimitStore({ maxHits });
  const hits = Array.from({ length: maxHits + 1 }, () => store.hit('k').allowed);
  assert(hits[0] === true, 'expected an early hit to be allowed');
  assert(hits[hits.length - 1] === false, 'expected the hit past maxHits to be rate-limited');

  // Checkout fail-closed helper: mock checkout stays available outside production.
  assert(checkoutUnavailableReason() === null, 'checkout should stay available outside production');

  // Groq mock is the keyless smoke default: no provider key is set in this environment.
  assert(GROQ_MOCK === true, 'expected GROQ_MOCK in the keyless smoke environment');

  console.log('SMOKE-OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
