import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { parseAmount, toMajor, type Minor } from '../core/money';
import { resolveCardId } from '../core/planning';
import type { Card, Subcategory, SubcategoryFrequency } from '../db/schema';
import { useAppStore } from '../store/useAppStore';
import { useTheme } from '../theme/ThemeProvider';
import { AccountField } from './AccountPicker';
import { DayPicker } from './DayPicker';
import {
  emptySavingPlanDraft,
  savingPlanDraftFrom,
  SavingPlanFields,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from './SavingPlanFields';
import { AmountField, Field, FrequencyPicker } from './forms';
import { Label, Row, Text } from './ui';

/**
 * Everything that describes a bill, as one reusable block.
 *
 * A bill is not just a name and an amount: how often it recurs, which day it is
 * due, which account it is paid from, and — for yearly bills — the saving plan
 * that collects for it are all part of the record. Two screens create or edit
 * bills (the plan list's "new bill in" sheet and the grid picker's manage
 * sheet), and when each owned its own form the second one quietly offered a
 * subset, so a bill added there could never be yearly or unplanned.
 *
 * The draft state lives in `useBillDraft` so a caller can seed it, read
 * `canSave`, and hand the result to `addSubcategory`/`updateSubcategory`
 * without re-deriving the saving-plan rules.
 */
export interface BillDraft {
  name: string;
  setName: (next: string) => void;
  amount: string;
  setAmount: (next: string) => void;
  dueDay: number;
  setDueDay: (next: number) => void;
  frequency: SubcategoryFrequency;
  setFrequency: (next: SubcategoryFrequency) => void;
  cardId: string | null;
  setCardId: (next: string | null) => void;
  plan: SavingPlanDraft;
  setPlan: (next: SavingPlanDraft) => void;
  /** True when the fields describe a saveable bill. */
  canSave: boolean;
  /**
   * The values to pass to `addSubcategory` / `updateSubcategory`, with the
   * saving-plan and account-inheritance rules already applied.
   */
  toPatch: () => {
    name: string;
    plannedMinor: Minor;
    dueDay: number;
    frequency: SubcategoryFrequency;
    cardId: string | null;
    planTargetMinor: Minor | null;
    planDueDate: Date | null;
    planStartDate: Date | null;
  };
}

export function useBillDraft({
  existing,
  categoryDueDay,
  categoryCardId,
  /** Changes to this value re-seed the draft — pass the id being edited. */
  resetKey,
}: {
  existing?: Subcategory;
  categoryDueDay?: number | null;
  categoryCardId?: string | null;
  resetKey?: string | null;
}): BillDraft {
  const [name, setName] = React.useState(existing?.name ?? '');
  const [amount, setAmount] = React.useState(
    existing ? String(toMajor(existing.plannedMinor)) : '',
  );
  const [dueDay, setDueDay] = React.useState(existing?.dueDay ?? categoryDueDay ?? 1);
  const [frequency, setFrequency] = React.useState<SubcategoryFrequency>(
    existing?.frequency ?? 'monthly',
  );
  // Seeded with the category's account so the field shows the right answer on
  // open, rather than an empty "choose" the user fills in every time.
  const [cardId, setCardId] = React.useState<string | null>(
    existing?.cardId ?? categoryCardId ?? null,
  );
  const [plan, setPlan] = React.useState<SavingPlanDraft>(() =>
    existing ? savingPlanDraftFrom(existing) : emptySavingPlanDraft,
  );

  // Re-seed whenever the target changes. Keyed on `resetKey` alone so a store
  // refresh mid-edit never clears what the user is typing.
  React.useEffect(() => {
    setName(existing?.name ?? '');
    setAmount(existing ? String(toMajor(existing.plannedMinor)) : '');
    setDueDay(existing?.dueDay ?? categoryDueDay ?? 1);
    setFrequency(existing?.frequency ?? 'monthly');
    setCardId(existing?.cardId ?? categoryCardId ?? null);
    setPlan(existing ? savingPlanDraftFrom(existing) : emptySavingPlanDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Saving plans belong only to yearly bills, matching the rest of the app.
  const planPatch = frequency === 'yearly' ? toSavingPlanPatch(plan) : null;
  // With a saving plan the monthly set-aside *is* the planned amount.
  const plannedMinor = planPatch ? planPatch.monthlyMinor : (parseAmount(amount) ?? 0);

  const canSave =
    Boolean(name.trim()) && (frequency !== 'yearly' || !plan.enabled || planPatch !== null);

  return {
    name,
    setName,
    amount,
    setAmount,
    dueDay,
    setDueDay,
    frequency,
    setFrequency,
    cardId,
    setCardId,
    plan,
    setPlan,
    canSave,
    toPatch: () => ({
      name: name.trim(),
      plannedMinor,
      dueDay,
      frequency,
      // Accepting the pre-filled category account is not an override: store null
      // so the bill keeps *inheriting*, and later changing the category's
      // account still moves it.
      cardId: cardId === categoryCardId ? null : cardId,
      planTargetMinor: planPatch?.planTargetMinor ?? null,
      planDueDate: planPatch?.planDueDate ?? null,
      planStartDate: planPatch?.planStartDate ?? null,
    }),
  };
}

export function BillFields({
  draft,
  cards,
  /** The category this bill sits in, for the account hint and defaults. */
  category,
  amountAutoFocus,
}: {
  draft: BillDraft;
  cards: readonly Card[];
  category?: { id: string; name: string; cardId: string | null } | undefined;
  amountAutoFocus?: boolean;
}) {
  const { colors, space } = useTheme();
  const state = useAppStore();

  const unplanned = draft.frequency === 'unplanned';
  const planPatch = draft.frequency === 'yearly' ? toSavingPlanPatch(draft.plan) : null;
  // Shown in the hint when nothing overrides the category's account.
  const effectiveCardId = resolveCardId(draft.cardId, category?.cardId);

  return (
    <>
      {/* Amount hero. With a saving plan (yearly) the monthly figure is derived
          and shown read-only. Otherwise it is entered — for a spending budget
          it is the monthly cap its entries are drawn against, not a bill to pay
          once. */}
      {draft.plan.enabled && draft.frequency === 'yearly' ? (
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Label>MONTHLY SET-ASIDE</Label>
          <Row gap={space.xs} align="center">
            <Text variant="title" tone="muted">
              {state.currency}
            </Text>
            <Text
              style={{
                fontSize: 42,
                fontWeight: '800',
                letterSpacing: -1.2,
                color: planPatch ? colors.ink : colors.inkMuted,
              }}
            >
              {planPatch ? String(planPatch.monthlyMinor / 100) : '—'}
            </Text>
          </Row>
        </View>
      ) : (
        <AmountField
          label={unplanned ? 'Monthly budget' : 'Amount'}
          value={draft.amount}
          onChangeText={draft.setAmount}
          currency={state.currency}
          autoFocus={amountAutoFocus}
        />
      )}

      <Field
        label="What is it?"
        value={draft.name}
        onChangeText={draft.setName}
        placeholder="e.g. Rent, Electricity, Netflix"
      />

      {/* Paid from — overrides the category's account for this bill. Null means
          the bill keeps inheriting. */}
      {cards.length > 0 ? (
        <View style={{ gap: 4 }}>
          <AccountField
            label="Paid from"
            cards={cards}
            selectedId={draft.cardId}
            onSelect={draft.setCardId}
            allowNone
          />
          <Text variant="caption" tone="muted">
            {effectiveCardId && effectiveCardId === category?.cardId
              ? `${category?.name}’s account, filled in for you — change it if this bill is paid from another.`
              : 'Change it if this bill is paid from a different account.'}
          </Text>
        </View>
      ) : null}

      <FrequencyPicker
        label="How often?"
        value={draft.frequency}
        onChange={draft.setFrequency}
        includeUnplanned
      />

      {/* Payment day — not applicable to unplanned bills. */}
      {!unplanned ? <DayPicker value={draft.dueDay} onChange={draft.setDueDay} /> : null}

      {/* Saving plan — yearly bills only: a big amount due later, collected
          monthly. */}
      {draft.frequency === 'yearly' ? (
        <SavingPlanFields draft={draft.plan} onChange={draft.setPlan} />
      ) : null}
    </>
  );
}
