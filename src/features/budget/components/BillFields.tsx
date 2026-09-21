import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { formatAmountInput, toMajor, type Minor } from '~/shared/lib/money';
import { amountExpressionTotal } from '~/shared/lib/amountExpression';
import { resolveCardId } from '~/features/budget/logic/planning';
import { isHouseScopedName } from '~/features/budget/logic/houses';
import type { Card, Subcategory, SubcategoryFrequency } from '~/db/schema';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { AccountField } from '~/features/accounts/components/AccountPicker';
import { DayPicker } from './DayPicker';
import {
  emptySavingPlanDraft,
  savingPlanDraftFrom,
  SavingPlanFields,
  toSavingPlanPatch,
  type SavingPlanDraft,
} from './SavingPlanFields';
import {
  AmountField,
  Field,
  FrequencyPicker,
  IconPicker,
  NameWithIconField,
} from '~/shared/components/forms';
import { Label, Row, Text } from '~/shared/components/ui';

/**
 * Everything that describes a bill, as one reusable block.
 *
 * A bill is not just a name and an amount: how often it recurs, which day it is
 * due, which account it is paid from, and — for yearly bills — the saving plan
 * that collects for it are all part of the record. Two screens create or edit
 * bills (the plan list's "new bill in" sheet and the grid picker's manage
 * sheet), and when each owned its own form the second one quietly offered a
 * subset, so a bill added there could never be yearly or ongoing.
 *
 * The draft state lives in `useBillDraft` so a caller can seed it, read
 * `canSave`, and hand the result to `addSubcategory`/`updateSubcategory`
 * without re-deriving the saving-plan rules.
 */
export interface BillDraft {
  name: string;
  setName: (next: string) => void;
  icon: keyof typeof Ionicons.glyphMap;
  setIcon: (next: keyof typeof Ionicons.glyphMap) => void;
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
    icon: string;
    plannedMinor: Minor;
    dueDay: number;
    frequency: SubcategoryFrequency;
    cardId: string | null;
    /** Set only when creating — see `toPatch`. */
    houseScoped?: boolean;
    planTargetMinor: Minor | null;
    planDueDate: Date | null;
    planStartDate: Date | null;
  };
}

/** What a bill wears on the board before the user picks something better. */
const DEFAULT_BILL_ICON = 'pricetag-outline' satisfies keyof typeof Ionicons.glyphMap;

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
  const [icon, setIcon] = React.useState<keyof typeof Ionicons.glyphMap>(
    (existing?.icon as keyof typeof Ionicons.glyphMap) ?? DEFAULT_BILL_ICON,
  );
  /*
   * Seeded through the SAME formatter the field applies to typing.
   *
   * `AmountField` reshapes only what the user types, so a value put in
   * programmatically bypassed it: an existing bill opened reading "5000" while
   * the very first keystroke rewrote it to "5,000". Worse, the raw string is
   * what the caller then compares and saves, so a figure the user never
   * retyped round-tripped through a formatter that had never seen it.
   */
  const [amount, setAmount] = React.useState(
    existing ? formatAmountInput(String(toMajor(existing.plannedMinor))) : '',
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
    setIcon((existing?.icon as keyof typeof Ionicons.glyphMap) ?? DEFAULT_BILL_ICON);
    setAmount(existing ? formatAmountInput(String(toMajor(existing.plannedMinor))) : '');
    setDueDay(existing?.dueDay ?? categoryDueDay ?? 1);
    setFrequency(existing?.frequency ?? 'monthly');
    setCardId(existing?.cardId ?? categoryCardId ?? null);
    setPlan(existing ? savingPlanDraftFrom(existing) : emptySavingPlanDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Saving plans belong only to yearly bills, matching the rest of the app.
  const planPatch = frequency === 'yearly' ? toSavingPlanPatch(plan) : null;
  // With a saving plan the monthly set-aside *is* the planned amount.
  /*
   * `amountExpressionTotal`, NOT `parseAmount`.
   *
   * The field accepts a sum, and `parseAmount` strips the operators and
   * concatenates what is left — "100 + 5,000" would save as 1,005,000 rather
   * than 5,100. It still reads a single figure identically, so this is the
   * right call for both shapes.
   */
  const plannedMinor = planPatch
    ? planPatch.monthlyMinor
    : (amountExpressionTotal(amount) ?? 0);

  const canSave =
    Boolean(name.trim()) && (frequency !== 'yearly' || !plan.enabled || planPatch !== null);

  return {
    name,
    setName,
    icon,
    setIcon,
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
      icon,
      plannedMinor,
      dueDay,
      frequency,
      /*
       * Per-property bills scope themselves from their name — on a NEW bill.
       *
       * Every other creation path already does this: the SMS draft from its
       * hint, onboarding from its catalog id. A bill typed in by hand was the
       * one route that produced an unscoped "Electricity", so the house picker
       * never appeared on it. `isHouseScopedName` existed for exactly this and
       * had no callers.
       *
       * Inferred rather than asked, because on a single-house board the answer
       * changes nothing visible (see `shouldAskForHouse`) — a toggle would be a
       * question almost nobody needs to answer.
       *
       * An EXISTING bill keeps what it has. `ManagePlanSheet` spreads this
       * whole patch into `updateSubcategory`, so inferring here would let a
       * rename — or a plain re-save — overwrite scoping that an SMS hint set
       * deliberately, and no name pattern can recover it.
       */
      ...(existing ? null : { houseScoped: isHouseScopedName(name) }),
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
  nameAutoFocus,
}: {
  draft: BillDraft;
  cards: readonly Card[];
  category?:
    | { id: string; name: string; cardId: string | null; color?: string | null }
    | undefined;
  /** Focus the name on open — it is the first field the form asks for. */
  nameAutoFocus?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const state = useAppStore();

  const ongoing = draft.frequency === 'ongoing';
  const planPatch = draft.frequency === 'yearly' ? toSavingPlanPatch(draft.plan) : null;
  // Shown in the hint when nothing overrides the category's account.
  const effectiveCardId = resolveCardId(draft.cardId, category?.cardId);

  return (
    <>
      {/*
        WHAT IT IS, first.

        The amount used to open the form, which asked how much before the user
        had said what they were adding — and the answer to "how much" often
        depends on having named the thing. Naming it first also means the icon
        row below is chosen against a name that is already on screen.
      */}
      <NameWithIconField
        label="What is it?"
        value={draft.name}
        onChangeText={draft.setName}
        icon={draft.icon}
        iconColor={category?.color ?? colors.accent}
        placeholder="e.g. Rent, Electricity, Netflix"
        autoFocus={nameAutoFocus}
      />

      {/* Icon grid, as on the detail screen and the category editor. Every
          bill added here used to start on the default tag and could only be
          re-iconed after the fact, by opening it again. */}
      <IconPicker
        value={draft.icon}
        onChange={draft.setIcon}
        accent={category?.color ?? colors.accent}
      />

      {/* The amount. With a saving plan (yearly) the monthly figure is derived
          and shown read-only. Otherwise it is entered — for a spending budget
          it is the monthly cap its entries are drawn against, not a bill to pay
          once. */}
      {draft.plan.enabled && draft.frequency === 'yearly' ? (
        <View style={{ gap: space.sm }}>
          <Label>MONTHLY SET-ASIDE</Label>
          {/*
            Shaped like the inert `Field` next to it, not like the old 42px
            hero it used to mirror. The figure is derived from the plan, so it
            reads as a field the form is filling in rather than one awaiting an
            answer — sunken ground and muted text, the same way `Field` renders
            a value the screen shows but does not own.
          */}
          <Row
            gap={space.sm}
            align="center"
            style={{
              backgroundColor: colors.surfaceSunken,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              paddingHorizontal: space.md,
              paddingVertical: 13,
            }}
          >
            <Text variant="small" tone="muted">
              {state.currency}
            </Text>
            <Text
              style={{
                flex: 1,
                fontSize: 16,
                color: planPatch ? colors.ink : colors.inkMuted,
              }}
            >
              {planPatch ? String(planPatch.monthlyMinor / 100) : '—'}
            </Text>
          </Row>
        </View>
      ) : (
        <AmountField
          // "Plan amount" — what this line is expected to cost, as opposed to
          // the actual logged against it each month. One label for every
          // cadence: an ongoing line's figure is the same planned number, and
          // calling it "Monthly budget" here while the detail screen and the
          // onboarding step both said "Plan amount" made one field look like
          // three different ones depending on where it was opened.
          label="Plan amount"
          value={draft.amount}
          onChangeText={draft.setAmount}
          currency={state.currency}
          // A normal field, not the 42px headline. The hero belongs where the
          // amount IS the screen — logging a payment — but here it is one of
          // six things being described, and sizing it like the headline act of
          // the form put the weight on the figure rather than the bill. It now
          // matches the name and account fields it sits between.
          hero={false}
          /*
            A plan amount is often several costs the user knows separately —
            three subscriptions, a rent plus its service charge — so it can be
            typed as "100 + 5,000 + 1,000" and the total is what gets saved.
          */
          allowExpression
        />
      )}

      {/*
        Paid from — overrides the category's account for this bill. Null means
        the bill keeps inheriting.

        Shown even with no accounts yet: `AccountField` renders "Add an account"
        in that case and its picker can now create one in place. Hiding the
        whole field when the list was empty removed the only route to fixing
        that, at exactly the moment the user needed it.
      */}
      <View style={{ gap: 4 }}>
        <AccountField
          label="Paid from"
          cards={cards}
          selectedId={draft.cardId}
          onSelect={draft.setCardId}
          allowNone
        />
        <Text variant="caption" tone="muted">
          {cards.length === 0
            ? 'Add the account this bill is paid from — you can rename it later.'
            : effectiveCardId && effectiveCardId === category?.cardId
              ? `${category?.name}’s account, filled in for you — change it if this bill is paid from another.`
              : 'Change it if this bill is paid from a different account.'}
        </Text>
      </View>

      <FrequencyPicker
        label="How is it paid?"
        value={draft.frequency}
        onChange={draft.setFrequency}
        includeOngoing
      />

      {/*
        Payment day — shown for every cadence, ongoing included.

        Hiding it for an ongoing line made that one option behave unlike its
        three siblings: the form visibly shortened when it was picked, which
        read as the choice having broken something. And the field does mean
        something here — a spending budget still has a day the money is set
        aside on, and "Flexible" is right there for a budget that genuinely has
        none. An ongoing line is left out of due-date reminders by its cadence
        (see `isReminderCandidate`), not by having no day, so nothing downstream
        turns it overdue.
      */}
      <DayPicker
        value={draft.dueDay}
        onChange={draft.setDueDay}
        label={ongoing ? 'SET-ASIDE DAY' : 'PAYMENT DAY'}
      />

      {/* Saving plan — yearly bills only: a big amount due later, collected
          monthly. */}
      {draft.frequency === 'yearly' ? (
        <SavingPlanFields draft={draft.plan} onChange={draft.setPlan} />
      ) : null}
    </>
  );
}
