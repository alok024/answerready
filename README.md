# AnswerReady

[![CI](https://github.com/alok024/answerready/actions/workflows/ci.yml/badge.svg)](https://github.com/alok024/answerready/actions/workflows/ci.yml) [![Deploy](https://github.com/alok024/answerready/actions/workflows/deploy.yml/badge.svg)](https://github.com/alok024/answerready/actions/workflows/deploy.yml)

Make your content citable by AI answer engines. AnswerReady turns a URL or a topic
into a generative-engine-optimization (GEO) kit so ChatGPT, Perplexity, Gemini, and
Google AI Overviews can find and quote you.

Each kit contains:

- **FAQ blocks** — 6-8 natural question/answer pairs written to be quoted directly.
- **schema.org JSON-LD** — a valid `FAQPage` document to paste into your page `<head>`.
- **llms.txt** — a plain-text manifest to host at `yoursite.com/llms.txt` for AI crawlers.
- **Citable snippets** — short, self-contained sentences AI engines lift into answers.

## How it works

1. Pick a mode (Topic or URL) and enter your topic or a live page URL.
2. `POST /api/generate` extracts page text (URL mode), then calls `lib/generate.generateKit`.
3. The FAQ pairs come from Groq `llama-3.3-70b-versatile`; the JSON-LD, llms.txt, and
   snippets are built **deterministically** from those pairs, so structured data is always valid.
4. With no `GROQ_API_KEY`, a mock responder synthesizes realistic template FAQs so the whole
   flow works offline with zero keys.

## Run locally (no API keys needed)

```bash
npm install
npm run build      # production build — must exit 0
npm run smoke      # end-to-end check of generateKit + mock checkout — prints SMOKE-OK
npm run dev        # local dev server at http://localhost:3000
```

Everything works in mock mode out of the box: the generator returns template FAQs and the
checkout completes with a locally-verified mock signature (no real charge).

## Pricing and the Razorpay checkout flow

| Plan          | Price          | Includes                                  |
| ------------- | -------------- | ----------------------------------------- |
| Single kit    | $19 one-time   | 1 full kit, all export formats            |
| Starter       | $29 / month    | 25 kits / month, email support            |
| Pro           | $79 / month    | 150 kits / month, bulk URL import         |

Checkout flow (identical order → verify → unlock loop in mock and live):

1. Browser `POST /api/checkout/order` with `{ planId }` → `createCheckoutOrder` looks up the
   plan and calls `createOrder(amount, currency, { planId })`.
2. **Mock mode (no keys):** the order route also returns a `mock_payment` (a payment id plus
   the exact `mockSignature`). The browser skips the modal, `POST /api/checkout/verify`, and
   the server accepts that signature — proving the loop end-to-end with no charge. The UI shows
   a visible "Test mode - no real charge" note.
3. **Live mode (keys set):** the browser loads `checkout.razorpay.com/v1/checkout.js`, opens the
   Razorpay modal, and takes `razorpay_payment_id` + `razorpay_signature` from the handler, then
   `POST /api/checkout/verify` HMAC-verifies the signature server-side before unlocking.

Both branches are in `app/page.tsx`; only the mock branch runs without keys.

## Real cost-per-use math

- Model: Groq `llama-3.3-70b-versatile`, roughly 1.5k input tokens + 2.5k output tokens per kit.
- Groq pricing is well under $1 per million tokens on this model, so a kit costs **~$0.003**.
- Sell at **$19 one-time** or **$29-$79 / month**. Even the single kit is a ~6,000x markup on
  compute; at 25-150 kits/month the marginal COGS is roughly $0.08-$0.45.
- **Gross margin ~96%** after payment-processing fees.

## Real API keys needed to go live

- `GROQ_API_KEY` (recommended) for real FAQ quality — optionally `OPENAI_API_KEY` as a fallback
  (`gpt-4o-mini`). Without either, the app runs in mock mode.
- `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` for real checkout (test keys also accepted via
  `RAZORPAY_TEST_KEY_ID` / `RAZORPAY_TEST_KEY_SECRET`). `RAZORPAY_WEBHOOK_SECRET` only if you add
  the webhook route.

See `.env.example` for the full list of variable names. No secrets are committed.

## Project layout

```
app/
  page.tsx                     landing + tool + pricing (client)
  layout.tsx                   metadata + globals
  globals.css                  shared design system (--accent #4f46e5)
  api/generate/route.ts        POST { mode, value } -> kit
  api/checkout/order/route.ts  POST { planId } -> order (+ mock_payment locally)
  api/checkout/verify/route.ts POST { order_id, payment_id, signature } -> { ok }
lib/
  generate.ts                  generateKit: FAQs + JSON-LD + llms.txt + snippets
  checkout.ts                  PLANS, createCheckoutOrder, confirmPurchase
  groq.ts                      Groq/OpenAI text helper with mock fallback
  razorpay.ts                  Razorpay helper with mock fallback
scripts/
  smoke.ts                     end-to-end smoke check
```
