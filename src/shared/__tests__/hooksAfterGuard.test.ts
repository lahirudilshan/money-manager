import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globSync } from 'tinyglobby';

/**
 * No hook may sit below an early `return` inside a component.
 *
 * ## The bug this exists to stop
 *
 * Deleting a bill re-rendered `app/subcategory/[id].tsx` with its row gone, so
 * the `if (!subcategory) return …` guard fired and every hook below it was
 * skipped. React had counted those hooks on the previous render, so it threw
 * "Rendered fewer hooks than expected" and the delete ended on a red screen
 * instead of a closed sheet. `app/account/[id].tsx` had the identical shape and
 * would have crashed the same way on deleting an account.
 *
 * Neither `yarn typecheck` nor the rest of the suite can see this: the code is
 * well-typed and every pure function it calls is correct. It only appears when
 * a specific render finds the record missing — which is exactly the render a
 * delete produces.
 *
 * `eslint-plugin-react-hooks` is the real tool for this and the repo has no
 * linter at all, so this test stands in for the rule until one is added.
 *
 * ## Why it is written on the source text
 *
 * The screens import expo-router, expo-sqlite and native modules that do not
 * exist under node, so they cannot be imported here. The check is therefore a
 * deliberately conservative read of the file: it tracks brace depth to stay
 * inside one function, and only flags a hook that is unambiguously below a
 * top-level early return in the same component.
 */

const ROOT = join(__dirname, '..', '..', '..');

/** A hook call at the start of a statement — `const x = useMemo(`, `useEffect(`. */
const HOOK = /(?:^|[\s=(,])(?:React\.)?use[A-Z]\w*\s*\(/;

/**
 * A component or hook declaration.
 *
 * Capitalised for a component, `use`-prefixed for a custom hook: the two kinds
 * of function where the rules of hooks apply.
 */
const DECLARES_COMPONENT =
  /^(?:export\s+)?(?:default\s+)?function\s+(?:[A-Z]\w*|use[A-Z]\w*)\s*\(/;

/** `}, [deps]);` and friends — a hook call closing, not a block ending. */
const HOOK_CLOSER = /^\s*\}(?:,|\)|\s*\)\s*;)/;

interface Finding {
  file: string;
  line: number;
  hook: string;
  guardLine: number;
}

/**
 * Read one file and report hooks that sit below an early return.
 *
 * Tracks brace depth from the component's opening line so a `return` inside a
 * nested callback — a `.map()`, an `onPress`, a `useMemo` body — is not
 * mistaken for an early return from the component itself.
 */
function findHooksAfterGuard(relativePath: string): Finding[] {
  const text = readFileSync(join(ROOT, relativePath), 'utf8');
  const lines = text.split('\n');

  const findings: Finding[] = [];

  let inComponent = false;
  let depth = 0;
  let guardLine = 0;
  /** True while inside a block opened by an `if` at the component's top level. */
  let guardBlock = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const code = line.replace(/\/\/.*$/, '');
    // Strings can carry braces that would throw the depth count off.
    const bare = code.replace(/(['"`]).*?\1/g, '');

    if (!inComponent && DECLARES_COMPONENT.test(line)) {
      inComponent = true;
      depth = 0;
      guardLine = 0;
    }

    if (!inComponent) continue;

    const opens = (bare.match(/\{/g) ?? []).length;
    const closes = (bare.match(/\}/g) ?? []).length;
    const depthBefore = depth;

    // An `if (…) {` at the component's top level opens a candidate guard block.
    if (depthBefore === 1 && opens > closes && /^\s{2}if\s*\(/.test(code)) {
      guardBlock = true;
    }

    /*
     * A `return` that leaves the component.
     *
     * Depth 1 is a bare `if (!row) return null;` on one line. Depth 2 is the
     * far commoner braced form, where the return sits inside the guard's own
     * block — both real bugs were written that way, and a first version of
     * this check looked only at depth 1 and so found neither.
     *
     * Depth 2 is only counted when the line opening that block was itself an
     * `if` at depth 1, which excludes a return inside a `.map()` callback or a
     * `useMemo` body.
     */
    const leavesComponent =
      (depthBefore === 1 && /^\s{2}return[\s(;]/.test(code)) ||
      (depthBefore === 2 && guardBlock && /^\s+return[\s(;]/.test(code));

    if (leavesComponent && guardLine === 0) {
      // The component's LAST return is the normal one, not a guard. Only a
      // return with more code after it can strand a hook.
      const rest = lines.slice(i + 1).join('\n');
      if (HOOK.test(rest)) guardLine = i + 1;
    }

    if (
      guardLine > 0 &&
      depthBefore === 1 &&
      HOOK.test(code) &&
      !HOOK_CLOSER.test(code)
    ) {
      findings.push({
        file: relativePath,
        line: i + 1,
        hook: code.trim().slice(0, 60),
        guardLine,
      });
    }

    depth += opens - closes;
    // Back at the top level, so any guard block has closed.
    if (depth <= 1) guardBlock = false;
    if (depth <= 0 && depthBefore > 0) {
      inComponent = false;
      guardLine = 0;
    }
  }

  return findings;
}

describe('rules of hooks — no hook below an early return', () => {
  // The fixtures are excluded: one of them is deliberately broken, and it is
  // asserted on directly by the self-checks below.
  const files = globSync(['app/**/*.tsx', 'src/**/*.tsx'], {
    cwd: ROOT,
    ignore: ['**/__tests__/fixtures/**'],
  });

  it('scans the screens', () => {
    // A glob that silently matched nothing would make every assertion below
    // vacuously true.
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds no hook stranded below a guard', () => {
    const findings = files.flatMap((file) => findHooksAfterGuard(file));

    const report = findings
      .map((f) => `${f.file}:${f.line} — ${f.hook} (guard at line ${f.guardLine})`)
      .join('\n');

    expect(report).toBe('');
  });

  /*
   * The detector has to actually detect. Without this, a change that broke the
   * brace counting would turn the test above into one that passes on
   * everything and protects nothing.
   */
  it('catches the shape it is looking for', () => {
    const findings = findHooksAfterGuard(
      'src/shared/__tests__/fixtures/hookAfterGuard.fixture.tsx',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].hook).toContain('useMemo');
  });

  /* A return inside a callback is not an early return from the component. */
  it('does not flag a return nested in a callback', () => {
    const findings = findHooksAfterGuard(
      'src/shared/__tests__/fixtures/nestedReturn.fixture.tsx',
    );

    expect(findings).toEqual([]);
  });
});
