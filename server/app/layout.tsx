import type { Metadata } from 'next';

/**
 * Required by the App Router, but this service has no UI — it is a JSON API.
 * Kept deliberately bare: no fonts, no CSS, nothing that would pull a client
 * bundle into a deployment that only ever answers with JSON.
 */
export const metadata: Metadata = {
  title: 'Money Manager catalog API',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
