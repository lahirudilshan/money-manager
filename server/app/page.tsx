/**
 * The service root — a live status page.
 *
 * Until now `/` was a 404, which is a bad first answer for the one URL a person
 * types from memory: it looks like the whole deployment is broken even when
 * every endpoint is healthy. This runs the same check as `/api/health` and says
 * plainly whether the API can reach its database.
 *
 * HTML rather than JSON, because this is the address a HUMAN visits — from a
 * browser, from the Vercel dashboard, from a bookmark. Machines get
 * `/api/health`, which is stable, parseable and the one to point a monitor at.
 * Both call `checkHealth`, so they can never disagree.
 *
 * No secrets, no counts beyond the catalog size, and nothing about the
 * infrastructure: this page is public and unauthenticated, exactly like the
 * health endpoint it mirrors.
 */

import { checkHealth } from '@/lib/health';

/*
 * No `dynamic = 'force-dynamic'` export.
 *
 * Under `cacheComponents` (enabled in next.config.ts) pages are dynamic by
 * default and the directive is explicitly redundant — see
 * docs/01-app/02-guides/migrating-to-cache-components.md. The uncached database
 * query in `checkHealth` also stops prerendering on its own, so this page is
 * request-time by construction. That matters: a status page frozen at build
 * time would report the world as it was when deployed, which is worse than
 * having no status page at all.
 */
export default async function StatusPage() {
  const report = await checkHealth();
  const healthy = report.status === 'ok';

  const accent = healthy ? '#0E9F6E' : '#DC2626';

  return (
    <main
      style={{
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        maxWidth: 560,
        margin: '0 auto',
        padding: '48px 24px',
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 20, margin: '0 0 4px', fontWeight: 600 }}>Money Manager catalog API</h1>
      <p style={{ margin: '0 0 28px', color: '#6B7280', fontSize: 14 }}>
        Shared merchant → category catalog.
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          border: `1px solid ${accent}33`,
          background: `${accent}0F`,
          borderRadius: 10,
          marginBottom: 24,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 10, height: 10, borderRadius: 5, background: accent, flexShrink: 0 }}
        />
        <strong style={{ color: accent, fontSize: 15 }}>
          {healthy ? 'Operational' : 'Database unreachable'}
        </strong>
      </div>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '8px 20px',
          margin: '0 0 28px',
          fontSize: 14,
        }}
      >
        <dt style={{ color: '#6B7280' }}>Database</dt>
        <dd style={{ margin: 0 }}>{report.database}</dd>

        {/*
          Only when the query succeeded. A zero here is the signal worth having:
          a reachable but EMPTY catalog serves valid, useless answers and the app
          degrades to local-only detection without anything reporting a fault.
        */}
        {report.merchants !== undefined ? (
          <>
            <dt style={{ color: '#6B7280' }}>Merchants</dt>
            <dd style={{ margin: 0 }}>
              {report.merchants.toLocaleString('en')}
              {report.merchants === 0 ? (
                <span style={{ color: '#B45309' }}> — catalog is empty, has it been seeded?</span>
              ) : null}
            </dd>
          </>
        ) : null}

        <dt style={{ color: '#6B7280' }}>Latency</dt>
        <dd style={{ margin: 0 }}>{report.latencyMs} ms</dd>

        <dt style={{ color: '#6B7280' }}>Checked</dt>
        <dd style={{ margin: 0 }}>{report.checkedAt}</dd>
      </dl>

      {/*
        Says outright that this page is not the thing to monitor.

        Next has no way for a PAGE to answer with a 503 — there is no
        `unavailable()` to match `notFound()` — so this URL returns 200 even
        while reporting a failure above. A monitor pointed here would call a
        dead database "up", so it has to be pointed at `/api/health`, which
        carries the honest status code.
      */}
      <p style={{ margin: 0, fontSize: 13, color: '#6B7280' }}>
        Point monitors at <code>/api/health</code> — it returns 200 when healthy and 503 when not.
        This page always answers 200, so it is for reading, not alerting.
      </p>
    </main>
  );
}
