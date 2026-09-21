import { describe, expect, it } from 'vitest';
import {
  amountExpressionTotal,
  evaluateAmountExpression,
  formatAmountExpression,
  isAmountSum,
} from '~/shared/lib/amountExpression';
import { formatAmountInput, parseAmount } from '~/shared/lib/money';

describe('evaluateAmountExpression', () => {
  it('reads a plain amount as before', () => {
    const result = evaluateAmountExpression('5000');
    expect(result.total).toBe(500_000);
    expect(result.isSum).toBe(false);
  });

  it('adds the terms of a sum', () => {
    const result = evaluateAmountExpression('100+5000+1000');
    expect(result.total).toBe(610_000);
    expect(result.terms).toEqual([10_000, 500_000, 100_000]);
    expect(result.isSum).toBe(true);
  });

  it('subtracts', () => {
    expect(amountExpressionTotal('5000-500')).toBe(450_000);
  });

  it('evaluates strictly left to right', () => {
    // No precedence to get wrong, by design.
    expect(amountExpressionTotal('100-50+25')).toBe(7_500);
  });

  it('handles decimals in any term', () => {
    expect(amountExpressionTotal('10.50+2.25')).toBe(1_275);
  });

  /*
   * The reason terms are converted to minor units before summing. In floating
   * point 0.1 + 0.2 is 0.30000000000000004, which would round to a total the
   * displayed breakdown does not add up to.
   */
  it('does not accumulate floating-point error', () => {
    expect(amountExpressionTotal('0.1+0.2')).toBe(30);
  });

  it('ignores the separators the formatter inserts', () => {
    expect(amountExpressionTotal('1,000 + 2,500')).toBe(350_000);
  });

  it('reads a leading minus as a negative amount', () => {
    expect(amountExpressionTotal('-500')).toBe(-50_000);
  });

  /* Typed a moment ago on the way to the next number — not an error state. */
  it('totals what has been typed so far when an operator is trailing', () => {
    const result = evaluateAmountExpression('100+');
    expect(result.total).toBe(10_000);
    expect(result.invalid).toBe(false);
  });

  it('is empty rather than invalid for empty input', () => {
    const result = evaluateAmountExpression('');
    expect(result.total).toBeNull();
    expect(result.invalid).toBe(false);
    expect(result.terms).toEqual([]);
  });

  it('flags text it cannot evaluate', () => {
    expect(evaluateAmountExpression('abc').invalid).toBe(true);
  });

  /* A slip, not a meaning: the later sign wins, as on a calculator. */
  it('survives a doubled operator', () => {
    expect(amountExpressionTotal('100++50')).toBe(15_000);
    expect(amountExpressionTotal('100+-50')).toBe(5_000);
  });

  it('is not a sum when only one term was typed', () => {
    expect(isAmountSum('5000')).toBe(false);
    expect(isAmountSum('100+50')).toBe(true);
  });
});

describe('formatAmountExpression', () => {
  it('groups a single term like the plain amount field', () => {
    expect(formatAmountExpression('5000')).toBe('5,000');
  });

  it('groups each term of a sum and spaces the operators', () => {
    expect(formatAmountExpression('1000+2500')).toBe('1,000 + 2,500');
  });

  /* Deleting the operator out from under the user mid-keystroke. */
  it('keeps a trailing operator while the next number is being typed', () => {
    expect(formatAmountExpression('100+')).toBe('100 +');
  });

  it('keeps at most two decimals per term', () => {
    expect(formatAmountExpression('10.999+5')).toBe('10.99 + 5');
  });

  it('drops characters it does not understand', () => {
    expect(formatAmountExpression('1a0b0')).toBe('100');
  });

  it('is empty for empty input', () => {
    expect(formatAmountExpression('')).toBe('');
  });

  it('round-trips through the evaluator', () => {
    const formatted = formatAmountExpression('100+5000+1000');
    expect(formatted).toBe('100 + 5,000 + 1,000');
    expect(amountExpressionTotal(formatted)).toBe(610_000);
  });
});

/*
 * An existing bill is seeded into the field by `formatAmountInput` (see
 * `useBillDraft`), and the field now reads that text with the expression
 * evaluator instead of `parseAmount`. The two must agree, or reopening a saved
 * bill and pressing Save without touching the amount would change it.
 */
describe('compatibility with the plain amount field', () => {
  it('reads a seeded amount identically to parseAmount', () => {
    for (const minor of [0, 500, 610_000, 1_234_567, 99_999_999]) {
      const seeded = formatAmountInput(String(minor / 100));
      expect(amountExpressionTotal(seeded)).toBe(parseAmount(seeded));
    }
  });

  it('leaves an already-formatted plain amount unchanged', () => {
    expect(formatAmountExpression('6,100')).toBe('6,100');
    expect(formatAmountExpression('1,234.56')).toBe('1,234.56');
  });
});
