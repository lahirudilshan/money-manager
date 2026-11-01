import { describe, expect, it } from 'vitest';
import { parseSms } from '../smsParser';
import { cardPaymentTwins } from '../smsInbox';
import { reconcileSms, type BoardSlice } from '../smsReconcile';

/** Messages from the user's review queue on 1 November 2026. */

const line = (id: string, name: string, categoryId: string) => ({
  id, name, type: 'expense' as const, plannedMinor: 0, categoryId, cardId: null, loanId: null,
});
const board: BoardSlice = {
  subcategories: [
    line('medicine', 'Medicine', 'health'),
    line('charges', 'Bank charges', 'fees'),
    { ...line('interest', 'Interest', 'income'), type: 'income' as const },
    line('card', 'NTB Credit card', 'debt'),
  ],
  categories: [
    { id: 'health', name: 'Health', cardId: null },
    { id: 'fees', name: 'Bank & fees', cardId: null },
    { id: 'income', name: 'Income', cardId: null },
    { id: 'debt', name: 'Debt', cardId: null },
  ],
  cards: [],
};

describe('NDB interest and the tax withheld on it', () => {
  it('names the interest credit and files it as income', () => {
    const interest = parseSms(
      'LKR 306.54 credited to AC XXXXXXXX6796 on 31 Oct 2026 19:03 as Interest - Capitalise. Avl Bal 128,717.28 Call 94112448888 for info',
    )!;
    expect(interest.merchant).toBe('Interest - Capitalise');
    expect(reconcileSms(interest, board, 'd').subcategoryId).toBe('interest');
  });

  it('reads "Debit Arrangement" as a bank charge', () => {
    const tax = parseSms(
      'LKR 30.65 debited from AC XXXXXXXX6796 on 31 Oct 2026 19:03 as Debit Arrangement. Avl Bal 128,717.28 Call 94112448888 for info',
    )!;
    expect(tax.merchant).toBe('Debit Arrangement');
    expect(tax.kind).toBe('bank_charge');
    expect(reconcileSms(tax, board, 'd').subcategoryId).toBe('charges');
  });
});

describe('merchants the queue could not place', () => {
  it('files "Ayana Medicals" as medicine', () => {
    const shop = parseSms(
      'LKR 16,000.00 debited from AC XXXXXXXX6796 as POS TXN on 12 Oct 2026 18:49 at Ayana Medicals PVT Ltd Yakkala. Avl Bal 201,920.02 Call 94112448888 for info',
    )!;
    expect(reconcileSms(shop, board, 'd').subcategoryId).toBe('medicine');
  });
});

describe('a credit-card bill is one payment, not two', () => {
  const bank = parseSms(
    'LKR 36,667.00 debited from AC XXXXXXXX6796 on 26 Oct 2026 09:44 as CEFTS Outward Transfer. Avl Bal 23,590.23 Call 94112448888 for info',
  )!;
  const card = parseSms('Thank you for your payment of LKR 36,667.00 made to Card # 376657*****3055 on 26-10-2026.')!;
  const other = parseSms(
    'LKR 36,667.00 debited from AC XXXXXXXX6796 on 10 Oct 2026 09:44 as CEFTS Outward Transfer. Avl Bal 23,590.23 Call 94112448888 for info',
  )!;

  it('retires the bank’s bare transfer and keeps the card’s message', () => {
    const twins = cardPaymentTwins([bank, card]);
    expect(twins.has(bank)).toBe(true);
    expect(twins.has(card)).toBe(false);
  });

  it('leaves a same-amount transfer weeks away alone', () => {
    expect(cardPaymentTwins([other, card]).size).toBe(0);
  });
});

describe('a vet is pet care, not medicine', () => {
  it('files the animal hospital under Pet', () => {
    const withPet: BoardSlice = {
      ...board,
      subcategories: [...board.subcategories, line('petfood', 'Food', 'pet')],
      categories: [...board.categories, { id: 'pet', name: 'Pet', cardId: null }],
    };
    const vet = parseSms(
      'LKR 1,900.00 debited from AC XXXXXXXX6796 as POS TXN on 24 Oct 2026 16:39 at PET CARE ANIMAL HOSPITA KADAWATHA. Avl Bal 68,176.23 Call 94112448888 for info',
    )!;
    const draft = reconcileSms(vet, withPet, 'd');
    expect(draft.hint).toBe('pet');
    expect(draft.subcategoryId).toBe('petfood');
  });
});

describe('an interest credit with nowhere to go', () => {
  it('is offered an "Interest / dividends" line, not the salary', async () => {
    const { proposalForHint, proposalKeyFor } = await import('../hintCatalog');
    const parsed = parseSms(
      'LKR 306.54 credited to AC XXXXXXXX6796 on 31 Oct 2026 19:03 as Interest - Capitalise. Avl Bal 128,717.28 Call 94112448888 for info',
    )!;
    const draft = reconcileSms(parsed, { ...board, subcategories: [] }, 'd');
    const proposal = proposalForHint(proposalKeyFor(draft));
    expect(proposal?.subcategory.name).toBe('Interest / dividends');
    expect(proposal?.type).toBe('income');
  });
});
