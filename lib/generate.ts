import { generateJSON, GROQ_MOCK, type ChatMessage } from './groq';
import { capText, MAX_PAGE_TEXT_CHARS } from './limits';

export interface Faq {
  q: string;
  a: string;
}

export interface Kit {
  faqs: Faq[];
  jsonld: string;
  llmstxt: string;
  snippets: string[];
}

export interface GenerateInput {
  mode: 'url' | 'topic';
  value: string;
  pageText?: string;
}

// Strip a leading "best ", "top 10 ", "the best " so question frames read naturally.
function questionPhrase(topic: string): string {
  return topic
    .replace(/^(the\s+)?(best|top|cheapest|greatest)\s+(\d+\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Derive a clean, human-readable topic from a raw URL path/host.
function topicFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs.length ? segs[segs.length - 1] : '';
    const raw = last || u.hostname.replace(/^www\./, '').split('.')[0];
    const cleaned = raw
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'this page';
  } catch {
    return url.trim() || 'this topic';
  }
}

function deriveTopic(input: GenerateInput): string {
  if (input.mode === 'topic') return input.value.trim();
  return topicFromUrl(input.value);
}

// Realistic, non-echo mock FAQs so the kit is genuinely useful with no API key.
function mockFaqs(topic: string): Faq[] {
  const title = titleCase(topic);
  const p = questionPhrase(topic);
  return [
    {
      q: `What is ${p}, in simple terms?`,
      a: `${title} refers to the products, tools, or approaches people use to solve a specific need in this area. Understanding the basics first lets you compare options on the same terms and avoid paying for features you will not use. Start by getting clear on the single outcome you want before you look at any specific choice.`,
    },
    {
      q: `How do I get started with ${p}?`,
      a: `The fastest way to get started with ${p} is to write down your top two requirements and your budget, then shortlist three options that clearly meet them. Try the highest-rated option first, since a proven choice lowers the risk of an expensive mistake. Give yourself a short trial window so you can switch early if it is not a fit.`,
    },
    {
      q: `What should I look for when evaluating ${p}?`,
      a: `When evaluating ${p}, weigh reliability, total cost over a year, and how well it fits your specific situation rather than a generic average. Independent reviews and real user feedback usually surface issues that marketing pages leave out. Prioritize the two or three factors that matter most to you and treat the rest as tie-breakers.`,
    },
    {
      q: `How much should I expect to pay for ${p}?`,
      a: `Costs for ${p} vary widely depending on quality tier, brand, and whether you pay once or monthly. Expect a clear jump in durability and support between the budget and mid tiers, with diminishing returns at the premium end. Set a realistic budget range first, then find the best value inside it instead of chasing the lowest sticker price.`,
    },
    {
      q: `What are the most common mistakes to avoid with ${p}?`,
      a: `The most common mistake with ${p} is choosing on price alone and ignoring the long-term cost of a poor fit. People also over-buy features they never use, which inflates the price without improving the result. Match the choice to your actual usage, and re-check it after a few weeks to confirm it still fits.`,
    },
    {
      q: `How do I know if ${p} is right for me?`,
      a: `${title} is a good fit if it solves a problem you run into regularly and the cost is justified by the time or money it saves. If your need is only occasional, a cheaper or shared option may serve you better. Be honest about how often you will actually use it before committing.`,
    },
  ];
}

function buildMockResponse(topic: string): string {
  return JSON.stringify({ faqs: mockFaqs(topic) });
}

function normalizeFaqs(raw: unknown): Faq[] {
  const arr = Array.isArray((raw as { faqs?: unknown[] })?.faqs)
    ? (raw as { faqs: unknown[] }).faqs
    : [];
  const out: Faq[] = [];
  for (const item of arr) {
    const o = item as Record<string, unknown>;
    const q = String(o.q ?? o.question ?? '').trim();
    const a = String(o.a ?? o.answer ?? '').trim();
    if (q && a) out.push({ q, a });
  }
  return out.slice(0, 8);
}

// Deterministic, valid schema.org FAQPage JSON-LD built from the FAQs.
function buildJsonLd(faqs: Faq[]): string {
  const doc = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a,
      },
    })),
  };
  return JSON.stringify(doc, null, 2);
}

// URL-safe anchor slug from a question; deduped against slugs already used in this document.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug(text: string, seen: Set<string>): string {
  const base = slugify(text) || 'question';
  let slug = base;
  let i = 2;
  while (seen.has(slug)) slug = `${base}-${i++}`;
  seen.add(slug);
  return slug;
}

// First sentence of an answer, truncated to a short per-item note.
function shortNote(answer: string, max = 100): string {
  const first = answer.split(/(?<=[.!?])\s+/)[0]?.trim() ?? '';
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

// Deterministic, spec-compliant llms.txt (llmstxt.org shape): H1 title, blockquote
// summary, then a curated markdown link list AI crawlers can parse and cite.
function buildLlmsTxt(topic: string, faqs: Faq[]): string {
  const title = titleCase(topic);
  const seen = new Set<string>();
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> A concise, citable FAQ and answer-engine-optimization kit for "${topic}".`);
  lines.push('');
  lines.push('## Key FAQs');
  for (const f of faqs) {
    const slug = uniqueSlug(f.q, seen);
    lines.push(`- [${f.q}](#${slug}): ${shortNote(f.a)}`);
  }
  lines.push('');
  return lines.join('\n');
}

// 4-6 short, self-contained sentences pulled from the answers for direct citation.
function buildSnippets(faqs: Faq[]): string[] {
  const snippets: string[] = [];
  for (const f of faqs) {
    const first = f.a.split(/(?<=[.!?])\s+/)[0]?.trim();
    if (first) snippets.push(first.endsWith('.') ? first : `${first}.`);
    if (snippets.length >= 6) break;
  }
  return snippets;
}

export async function generateKit(input: GenerateInput): Promise<Kit> {
  const topic = capText(deriveTopic(input) || 'this topic');

  const context =
    input.mode === 'url' && input.pageText
      ? `Source page content (may be truncated):\n"""\n${input.pageText.slice(0, MAX_PAGE_TEXT_CHARS)}\n"""`
      : `Topic: "${topic}"`;

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a GEO (generative engine optimization) expert. You write FAQ content that AI answer engines like ChatGPT, Perplexity, and Google AI Overviews will quote directly. Answers must be specific, self-contained, factual, and free of fluff. Return ONLY valid JSON.',
    },
    {
      role: 'user',
      content: `${context}

Write 6 to 8 frequently asked questions and answers that a searcher would ask about this. Each question must be natural and specific. Each answer must be 2-3 sentences, self-contained (readable out of context), and directly quotable. Do not repeat the question in the answer. Do not include marketing language.

Return JSON of exactly this shape: {"faqs":[{"q":"question text","a":"answer text"}]}`,
    },
  ];

  const raw = await generateJSON<{ faqs: Faq[] }>(messages, {
    temperature: 0.5,
    max_tokens: 1800,
    mockResponder: () => buildMockResponse(topic),
  });

  let faqs = normalizeFaqs(raw);
  if (faqs.length < 4) {
    // Keyless dev/test only: a real provider returning this thin must fail loudly, not be papered over.
    if (!GROQ_MOCK) throw new Error(`Provider returned ${faqs.length} usable FAQs, need at least 4`);
    faqs = mockFaqs(topic);
  }

  return {
    faqs,
    jsonld: buildJsonLd(faqs),
    llmstxt: buildLlmsTxt(topic, faqs),
    snippets: buildSnippets(faqs),
  };
}
