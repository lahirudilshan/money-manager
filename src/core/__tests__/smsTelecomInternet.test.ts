import { describe, expect, it } from 'vitest';
import { inferCategoryHint } from '../smsCategoryHints';

/**
 * "STARLINK INTERNET" must read as a telecom bill.
 *
 * The word `internet` was defined in HINT_SELF_WORDS but NOT in HINT_KEYWORDS,
 * and only the latter is run against message text — HINT_SELF_WORDS matches a
 * BILL's own name. So an alert naming an internet provider the keyword list had
 * never heard of matched nothing at all, and the draft arrived with no category
 * suggestion even though the message said "INTERNET" in capitals.
 *
 * The provider list can never be complete (Starlink is not a Sri Lankan telco
 * and no list would have predicted it), which is exactly why the SERVICE words
 * have to be message-level keywords too.
 */
describe('internet / broadband as telecom', () => {
  it('recognises the provider that prompted this', () => {
    expect(inferCategoryHint('STARLINK INTERNET')).toBe('telecom');
  });

  it('recognises it inside a full bank alert', () => {
    expect(inferCategoryHint('LKR 8,500.00 debited at STARLINK INTERNET on 02/08')).toBe('telecom');
  });

  /** The brand alone, now seeded, without the service word. */
  it('recognises the brand on its own', () => {
    expect(inferCategoryHint('STARLINK')).toBe('telecom');
  });

  it('recognises a broadband bill from an unlisted provider', () => {
    expect(inferCategoryHint('MONTHLY BROADBAND BILL DUE')).toBe('telecom');
  });

  /** Case must not matter — banks print merchant names in caps. */
  it('is case-insensitive', () => {
    expect(inferCategoryHint('starlink internet')).toBe('telecom');
  });

  /**
   * The regression the naive fix introduced.
   *
   * "Internet banking" is how a great many banks describe the CHANNEL a
   * transfer used. Matching it as telecom turned every such transfer into a
   * phone bill — a far more common message than an internet bill, so the fix
   * would have cost more than it gained.
   */
  it('does not read "internet banking" as telecom', () => {
    expect(inferCategoryHint('Transfer via Internet Banking to AC 123')).toBe('transfer');
  });

  it('does not read capitalised INTERNET BANKING as telecom', () => {
    expect(inferCategoryHint('INTERNET BANKING TRANSFER LKR 5,000')).toBe('transfer');
  });

  /** The known providers must keep working exactly as before. */
  it('still recognises the listed local providers', () => {
    expect(inferCategoryHint('DIALOG RELOAD')).toBe('telecom');
    expect(inferCategoryHint('SLT POSTPAID BILL')).toBe('telecom');
    expect(inferCategoryHint('MOBITEL PREPAID')).toBe('telecom');
  });

  /** Unrelated categories must not have shifted. */
  it('leaves other categories untouched', () => {
    expect(inferCategoryHint('LKR 500 debited at KEELLS')).toBe('groceries');
    expect(inferCategoryHint('CEB ELECTRICITY BILL')).toBe('electricity');
    expect(inferCategoryHint('ATM CASH WITHDRAWAL')).toBe('atm');
  });
});
