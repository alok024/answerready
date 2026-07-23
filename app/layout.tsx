import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AnswerReady — Get cited by ChatGPT, Perplexity and Google AI Overviews',
  description:
    'Turn any URL or topic into an answer-engine-optimization kit: FAQ blocks, valid schema.org FAQPage JSON-LD, an llms.txt file, and citable snippets.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
