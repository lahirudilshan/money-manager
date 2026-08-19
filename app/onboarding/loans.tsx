import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import {
  emptyLoanDraft,
  isLoanDraftValid,
  LoanForm,
  loanDraftFrom,
  loanDraftToInput,
  type LoanDraft,
} from '~/features/loans/components/LoanForm';
import { BottomSheet, Divider, FOOTER_CLEARANCE, GradientButton, Label, PinnedFooter, Row, StepHeader, Surface, Text } from '~/shared/components/ui';
import { formatMoney } from '~/shared/lib/money';
import { resolveBrand } from '~/shared/data/banks';
import { selectLoanViews, useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

const LOAN_KIND_LABEL: Record<string, string> = {
  personal: 'Personal loan',
  lease: 'Lease',
  mortgage: 'Mortgage',
  other: 'Loan',
};

/**
 * Onboarding step 4: add any loans or leases.
 *
 * Debt is the part of a plan people most want visible, and entering it here
 * means the dashboard is meaningful from day one. Repeatable — add as many as
 * you actually carry — and fully skippable, since plenty of people have none.
 */
export default function OnboardingLoansScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const state = useAppStore();

  const views = useMemo(() => selectLoanViews(state), [state]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LoanDraft>(emptyLoanDraft);
  /**
   * Which loan the sheet is editing, or null when it is adding a new one.
   *
   * A loan is eight fields of typing, and a rate entered as 11.5 when it should
   * have been 15.1 previously had to be deleted and rebuilt from scratch — on
   * the very screen where the user is checking the numbers against their bank's
   * paperwork. The sheet is the same either way; only what Save does differs.
   */
  const [editingId, setEditingId] = useState<string | null>(null);

  const monthly = views.reduce((sum, v) => sum + v.installmentMinor, 0);

  function openNew() {
    setEditingId(null);
    setDraft(emptyLoanDraft);
    setOpen(true);
  }

  function openEdit(view: (typeof views)[number]) {
    setEditingId(view.loan.id);
    setDraft(loanDraftFrom(view.loan));
    setOpen(true);
  }

  function handleSave() {
    if (!isLoanDraftValid(draft)) return;

    const input = loanDraftToInput(draft, colors.pending);

    if (editingId) {
      state.updateLoan(editingId, input);
    } else {
      state.addLoan(input);
    }

    setDraft(emptyLoanDraft);
    setEditingId(null);
    setOpen(false);
  }

  return (
    <>
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        {/*
          No back arrow here, deliberately.

          Step 4 commits the plan to the database and calls `draft.reset()`
          before pushing to this screen, so stepping back would land on an empty
          plan with its "Build" button disabled — a dead end — and pressing it
          again would duplicate every category. Loans are addable any time from
          the Loans tab, so there is nothing here the user is trapped out of.
        */}
        <StepHeader step={5} title="Any loans or leases?">
          Add what you're repaying so the plan knows your commitments. Skip
          if you have none — you can add them any time.
        </StepHeader>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            // Clears the pinned footer, which overlays this list. See FOOTER_CLEARANCE.
            paddingBottom: space.xl + FOOTER_CLEARANCE,
            paddingHorizontal: space.lg,
            gap: space.lg,
          }}
          showsVerticalScrollIndicator={false}
        >
          {views.length > 0 ? (
            <Surface
              style={{
                gap: space.sm,
                backgroundColor: colors.pendingSoft,
                borderColor: colors.pending,
              }}
            >
              <Label color={colors.pending}>TOTAL PER MONTH</Label>
              <Text variant="display">{formatMoney(monthly)}</Text>
            </Surface>
          ) : null}

          {/* Added loans. */}
          {views.map((view) => {
            const brand = resolveBrand({ bankId: view.loan.bankId, name: view.loan.name });
            return (
              <Surface key={view.loan.id} padded={false} style={{ padding: space.md }}>
                <Row gap={space.md}>
                  {/* The row opens the loan for editing — see `openEdit`. The
                      delete stays its own control so a mis-tap cannot remove a
                      loan the user only meant to correct. */}
                  <Pressable
                    onPress={() => openEdit(view)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${view.loan.name}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                  <BankLogo brand={brand} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {view.loan.name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {LOAN_KIND_LABEL[view.loan.kind] ?? 'Loan'} ·{' '}
                      {formatMoney(view.loan.principalMinor, { compact: true })} at{' '}
                      {view.loan.annualRatePct}%
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="figure">{formatMoney(view.installmentMinor)}</Text>
                    <Text variant="caption" tone="muted">
                      / month
                    </Text>
                  </View>
                  </Pressable>
                  <Pressable
                    onPress={() => state.deleteLoan(view.loan.id)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${view.loan.name}`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Ionicons name="close-circle" size={20} color={colors.inkMuted} />
                  </Pressable>
                </Row>
              </Surface>
            );
          })}

          {/* Add another. */}
          <Pressable
            onPress={openNew}
            accessibilityRole="button"
            accessibilityLabel="Add a loan"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              paddingVertical: 18,
              borderRadius: 16,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: colors.hairlineStrong,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
            <Text variant="small" tone="secondary" style={{ fontWeight: '600' }}>
              {views.length > 0 ? 'Add another loan' : 'Add a loan or lease'}
            </Text>
          </Pressable>
        </ScrollView>

        <PinnedFooter>
          <GradientButton
            label={views.length > 0 ? 'Finish setup' : 'Skip — no loans'}
            icon="checkmark"
            onPress={() => router.push('/onboarding/done')}
          />
        </PinnedFooter>
      </View>

      {/* One sheet for both adding and editing, sharing the Loans tab's form —
          the fields are identical, so a second sheet could only drift. */}
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={editingId ? 'Edit loan' : 'New loan'}
        icon="cash-outline"
        iconColor={colors.pending}
        scroll
        footer={
          <GradientButton
            label={editingId ? 'Save changes' : 'Add loan'}
            icon="checkmark"
            onPress={handleSave}
            disabled={!isLoanDraftValid(draft)}
          />
        }
      >
        <LoanForm draft={draft} onChange={setDraft} />
      </BottomSheet>
    </>
  );
}
