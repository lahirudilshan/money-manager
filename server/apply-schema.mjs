/**
 * Apply schema.sql to the shared database.
 *
 * Neon's HTTP driver takes one statement per request, so the file is split
 * here. The split respects `--` comments, single-quoted literals and `$$`
 * function bodies — a naive split on ';' breaks on the semicolons inside both
 * the comments and the retally() body.
 *
 * Every statement is `IF NOT EXISTS` / `OR REPLACE`, so this is safe to re-run.
 *
 * Usage:  DATABASE_URL=... node server/apply-schema.mjs [path/to/schema.sql]
 */

import { neon } from '@neondatabase/serverless';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// Split on top-level semicolons only: a ';' inside a -- comment, a '...' string,
// or a $$ ... $$ function body is part of the statement, not a separator.
function split(ddl) {
  const out = [];
  let buf = '';
  let i = 0;
  while (i < ddl.length) {
    // Line comment: copy through end of line verbatim.
    if (ddl.startsWith('--', i)) {
      const end = ddl.indexOf('\n', i);
      const stop = end === -1 ? ddl.length : end + 1;
      buf += ddl.slice(i, stop);
      i = stop;
      continue;
    }
    // Dollar-quoted body: copy through the closing $$.
    if (ddl.startsWith('$$', i)) {
      const end = ddl.indexOf('$$', i + 2);
      const stop = end === -1 ? ddl.length : end + 2;
      buf += ddl.slice(i, stop);
      i = stop;
      continue;
    }
    // Single-quoted literal: copy through the closing quote ('' escapes).
    if (ddl[i] === "'") {
      let j = i + 1;
      while (j < ddl.length) {
        if (ddl[j] === "'" && ddl[j + 1] === "'") { j += 2; continue; }
        if (ddl[j] === "'") { j++; break; }
        j++;
      }
      buf += ddl.slice(i, j);
      i = j;
      continue;
    }
    if (ddl[i] === ';') {
      out.push(buf);
      buf = '';
      i++;
      continue;
    }
    buf += ddl[i];
    i++;
  }
  if (buf.trim()) out.push(buf);
  // Keep only fragments containing at least one non-comment line.
  return out
    .map((s) => s.trim())
    .filter((s) => s && s.split('\n').some((l) => l.trim() && !l.trim().startsWith('--')));
}

// Default to the schema beside this script, so `yarn schema` needs no argument.
const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? join(here, 'schema.sql');

(async () => {
  const stmts = split(fs.readFileSync(file, 'utf8'));
  for (const stmt of stmts) {
    const label = stmt.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')).trim();
    await sql.query(stmt);
    console.log('ok:', label.slice(0, 70));
  }
  const t = await sql`select table_name from information_schema.tables where table_schema='public' order by 1`;
  console.log('\ntables:', t.map((x) => x.table_name).join(', '));
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
