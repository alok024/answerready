'use client';

import { useState } from 'react';

interface Faq {
  q: string;
  a: string;
}
interface Kit {
  faqs: Faq[];
  jsonld: string;
  llmstxt: string;
  snippets: string[];
}
type TabKey = 'faqs' | 'jsonld' | 'llmstxt' | 'snippets';

interface PlanCard {
  id: string;
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  featured?: boolean;
}

const PLAN_CARDS: PlanCard[] = [
  {
    id: 'single_kit',
    name: 'Single kit',
    price: '$19',
    cadence: 'one-time',
    blurb: 'One complete GEO kit for a single page or topic.',
    features: ['1 full kit', 'FAQ + JSON-LD + llms.txt + snippets', 'Commercial use', 'No subscription'],
  },
  {
    id: 'starter_month',
    name: 'Starter',
    price: '$29',
    cadence: 'per month',
    blurb: 'For creators and small sites shipping content weekly.',
    features: ['25 kits / month', 'All export formats', 'Paste-a-topic or URL', 'Email support'],
    featured: true,
  },
  {
    id: 'pro_month',
    name: 'Pro',
    price: '$79',
    cadence: 'per month',
    blurb: 'For agencies and content teams optimizing at scale.',
    features: ['150 kits / month', 'Bulk URL import', 'Priority generation', 'Priority support'],
  },
];

const TABS: { key: TabKey; label: string }[] = [
  { key: 'faqs', label: 'FAQ blocks' },
  { key: 'jsonld', label: 'schema.org JSON-LD' },
  { key: 'llmstxt', label: 'llms.txt' },
  { key: 'snippets', label: 'Citable snippets' },
];

function loadRazorpay(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as unknown as { Razorpay?: unknown }).Razorpay) return resolve();
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(s);
  });
}

export default function Home() {
  const [mode, setMode] = useState<'url' | 'topic'>('topic');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [kit, setKit] = useState<Kit | null>(null);
  const [tab, setTab] = useState<TabKey>('faqs');
  const [copied, setCopied] = useState<string>('');

  const [unlocked, setUnlocked] = useState(false);
  const [buying, setBuying] = useState('');
  const [buyMsg, setBuyMsg] = useState('');

  async function generate() {
    const v = value.trim();
    if (!v) {
      setError('Please enter a URL or topic first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, value: v }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setKit(data as Kit);
      setTab('faqs');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1200);
    } catch {
      setCopied('');
    }
  }

  function download(filename: string, text: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function verify(order_id: string, payment_id: string, signature: string): Promise<boolean> {
    const res = await fetch('/api/checkout/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id, payment_id, signature }),
    });
    const data = await res.json();
    return !!data.ok;
  }

  async function purchase(planId: string) {
    setBuying(planId);
    setBuyMsg('');
    try {
      const res = await fetch('/api/checkout/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      const resp = await res.json();
      if (!res.ok) throw new Error(resp.error || 'Could not start checkout');

      if (resp.mock_payment) {
        const ok = await verify(resp.order_id, resp.mock_payment.payment_id, resp.mock_payment.signature);
        if (ok) {
          setUnlocked(true);
          setBuyMsg('Test mode - no real charge. Unlimited access unlocked locally.');
        } else {
          setBuyMsg('Verification failed.');
        }
      } else {
        await loadRazorpay();
        const RZP = (window as unknown as { Razorpay: new (o: unknown) => { open: () => void } }).Razorpay;
        const rzp = new RZP({
          key: resp.key,
          order_id: resp.order_id,
          amount: resp.amount,
          currency: resp.currency,
          name: 'AnswerReady',
          description: resp.label,
          handler: async (r: { razorpay_payment_id: string; razorpay_signature: string }) => {
            const ok = await verify(resp.order_id, r.razorpay_payment_id, r.razorpay_signature);
            if (ok) {
              setUnlocked(true);
              setBuyMsg('Payment successful. Unlimited access unlocked.');
            } else {
              setBuyMsg('Payment could not be verified.');
            }
          },
        });
        rzp.open();
      }
    } catch (err) {
      setBuyMsg(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setBuying('');
    }
  }

  const faqsPlain = kit
    ? kit.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`).join('\n\n')
    : '';

  return (
    <>
      <nav className="nav">
        <div className="brand">
          <span className="dot" />
          AnswerReady
        </div>
        <a className="btn secondary" href="#pricing">
          Pricing
        </a>
      </nav>

      <header className="hero container">
        <span className="eyebrow">Free GEO / AEO Kit Generator</span>
        <h1>
          Get cited by <span className="gradient-text">ChatGPT, Perplexity</span> and Google AI Overviews
        </h1>
        <p className="lead">
          Paste a URL or a topic and get a complete, free answer-engine-ready kit in seconds: FAQ blocks,
          valid schema.org FAQPage JSON-LD, an llms.txt file, and short, quotable snippets AI engines love
          to cite. No account and no paywall.
        </p>
        <div className="row" style={{ justifyContent: 'center', maxWidth: 420, margin: '0 auto' }}>
          <a className="btn lg" href="#tool">
            Generate your free kit
          </a>
          <a className="btn secondary lg" href="#how">
            How it works
          </a>
        </div>
      </header>

      <section className="section container" id="how">
        <div className="grid cols-2">
          <div className="card">
            <span className="badge warn">The problem</span>
            <h2 style={{ marginTop: 14 }}>Search is moving to answers, not links</h2>
            <p className="muted">
              AI answer engines summarize the web and cite a handful of sources. If your content is not structured
              the way they parse it, you are invisible in the exact place buyers now ask their questions.
            </p>
          </div>
          <div className="card">
            <span className="badge ok">The fix</span>
            <h2 style={{ marginTop: 14 }}>Feed engines what they quote</h2>
            <p className="muted">
              AnswerReady turns any page or topic into clean question-answer pairs, valid structured data, and an
              llms.txt manifest, so ChatGPT, Perplexity, Gemini, and Google AI Overviews can find and cite you.
            </p>
          </div>
        </div>

        <div className="grid cols-3" style={{ marginTop: 24 }}>
          <div className="card">
            <span className="badge">Step 1</span>
            <h3 style={{ marginTop: 12 }}>Point us at your content</h3>
            <p className="muted">Paste a live URL or just type the topic you want to rank for in AI answers.</p>
          </div>
          <div className="card">
            <span className="badge">Step 2</span>
            <h3 style={{ marginTop: 12 }}>Generate the kit</h3>
            <p className="muted">We produce FAQ pairs, FAQPage JSON-LD, llms.txt, and citable snippets instantly.</p>
          </div>
          <div className="card">
            <span className="badge">Step 3</span>
            <h3 style={{ marginTop: 12 }}>Copy, paste, get cited</h3>
            <p className="muted">Drop the JSON-LD in your head, publish the FAQ, and host llms.txt at your root.</p>
          </div>
        </div>
      </section>

      <section className="section container" id="tool">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <h2 style={{ margin: 0 }}>Build your GEO kit</h2>
            <span className="badge ok">Free, no limit</span>
          </div>

          <div className="row" style={{ marginTop: 18, marginBottom: 4 }}>
            <button
              type="button"
              className={mode === 'topic' ? 'btn' : 'btn secondary'}
              onClick={() => setMode('topic')}
              style={{ flex: 1 }}
            >
              Topic
            </button>
            <button
              type="button"
              className={mode === 'url' ? 'btn' : 'btn secondary'}
              onClick={() => setMode('url')}
              style={{ flex: 1 }}
            >
              URL
            </button>
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="tool-input">{mode === 'url' ? 'Page URL' : 'Topic or question'}</label>
            <input
              id="tool-input"
              type="text"
              value={value}
              placeholder={
                mode === 'url'
                  ? 'https://yoursite.com/blog/post'
                  : 'best running shoes for flat feet'
              }
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') generate();
              }}
            />
          </div>

          <button type="button" className="btn lg" onClick={generate} disabled={loading}>
            {loading ? <span className="spinner" /> : 'Generate kit'}
          </button>

          {error && (
            <p style={{ color: 'var(--err)', marginTop: 12, marginBottom: 0 }}>{error}</p>
          )}

          {kit && (
            <div style={{ marginTop: 24 }}>
              <div className="row" style={{ gap: 8 }}>
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={tab === t.key ? 'btn' : 'btn secondary'}
                    onClick={() => setTab(t.key)}
                    style={{ flex: 1, minWidth: 140, fontSize: '0.9rem', padding: '9px 14px' }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: 18 }}>
                {tab === 'faqs' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                      <button type="button" className="btn ghost" onClick={() => copy('faqs', faqsPlain)}>
                        {copied === 'faqs' ? 'Copied' : 'Copy all'}
                      </button>
                    </div>
                    <div className="grid" style={{ gap: 12 }}>
                      {kit.faqs.map((f, i) => (
                        <div key={i} className="card" style={{ boxShadow: 'none' }}>
                          <strong>{f.q}</strong>
                          <p className="muted" style={{ margin: '8px 0 0' }}>
                            {f.a}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {tab === 'jsonld' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                      <span className="muted" style={{ fontSize: '0.88rem' }}>
                        Paste inside a &lt;script type=&quot;application/ld+json&quot;&gt; tag in your page head.
                      </span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn ghost" onClick={() => copy('jsonld', kit.jsonld)}>
                          {copied === 'jsonld' ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => download('faqpage.jsonld', kit.jsonld, 'application/ld+json')}
                        >
                          Download
                        </button>
                      </span>
                    </div>
                    <pre>{kit.jsonld}</pre>
                  </div>
                )}

                {tab === 'llmstxt' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
                      <span className="muted" style={{ fontSize: '0.88rem' }}>
                        Host this at yoursite.com/llms.txt so AI crawlers can read your key answers.
                      </span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn ghost" onClick={() => copy('llmstxt', kit.llmstxt)}>
                          {copied === 'llmstxt' ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => download('llms.txt', kit.llmstxt, 'text/plain')}
                        >
                          Download
                        </button>
                      </span>
                    </div>
                    <pre>{kit.llmstxt}</pre>
                  </div>
                )}

                {tab === 'snippets' && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => copy('snippets', kit.snippets.join('\n'))}
                      >
                        {copied === 'snippets' ? 'Copied' : 'Copy all'}
                      </button>
                    </div>
                    <ul className="pill-list">
                      {kit.snippets.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="section container" id="pricing">
        <div className="center">
          <span className="eyebrow">Optional add-on</span>
          <h2>The kit generator is free. Pro is optional.</h2>
          <p className="lead" style={{ margin: '0 auto 8px' }}>
            Everything above is free to use, with no account and no limit. Pro is a future add-on for
            teams that want higher volume, bulk URL import, and priority generation — it is not required
            to generate your kit.
          </p>
        </div>

        <div className="grid cols-3" style={{ marginTop: 28 }}>
          {PLAN_CARDS.map((p) => (
            <div
              key={p.id}
              className="card"
              style={p.featured ? { borderColor: 'var(--accent)', boxShadow: 'var(--shadow)' } : undefined}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{p.name}</h3>
                {p.featured && <span className="badge ok">Most popular</span>}
              </div>
              <div className="price" style={{ marginTop: 12 }}>
                <span className="amt">{p.price}</span>
                <span className="muted">/ {p.cadence}</span>
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                {p.blurb}
              </p>
              <ul className="pill-list">
                {p.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <button
                type="button"
                className={p.featured ? 'btn lg' : 'btn secondary lg'}
                style={{ width: '100%' }}
                onClick={() => purchase(p.id)}
                disabled={buying === p.id || unlocked}
              >
                {unlocked ? 'Unlocked' : buying === p.id ? <span className="spinner" /> : `Buy ${p.name}`}
              </button>
            </div>
          ))}
        </div>

        {buyMsg && (
          <p className="center" style={{ marginTop: 18, color: unlocked ? 'var(--ok)' : 'var(--text)' }}>
            {buyMsg}
          </p>
        )}
      </section>

      <footer className="footer">
        <div className="container">
          AnswerReady — make your content citable by AI answer engines. Built for GEO.
        </div>
      </footer>
    </>
  );
}
