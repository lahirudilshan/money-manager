import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankLogo } from '../../src/components/BankLogo';
import { SheetHeader } from '../../src/components/forms';
import {
  emptyLoanDraft,
  isLoanDraftValid,
  LoanForm,
  loanDraftToInput,
  type LoanDraft,
} from '../../src/components/LoanForm';
import {
  Divider,
  GradientButton,
  Label,
  PinnedFooter,
  Row,
  Surface,
  T,
} from '../../src/components/ui';
import { formatMoney } from '../../src/core/money';
import { resolveBrand } from '../../src/data/banks';
import { selectLoanViews, useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  const views = useMemo(() => selectLoanViews(state), [state]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LoanDraft>(emptyLoanDraft);

  const monthly = views.reduce((sum, v) => sum + v.installmentMinor, 0);

  function handleAdd() {
    if (!isLoanDraftValid(draft)) return;
    state.addLoan(loanDraftToInput(draft, colors.pending));
    setDraft(emptyLoanDraft);
    setOpen(false);
  }

  return (
    <>
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: insets.top + space.lg,
            paddingBottom: space.xl,
            paddingHorizontal: space.lg,
            gap: space.lg,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: 2 }}>
            <Label>STEP 4 OF 4</Label>
            <T variant="title">Any loans or leases?</T>
            <T variant="small" tone="muted">
              Add what you're repaying so the plan knows your commitments. Skip
              if you have none — you can add them any time.
            </T>
          </View>

          {views.length > 0 ? (
            <Surface
              style={{
                gap: space.sm,
                backgroundColor: colors.pendingSoft,
                borderColor: colors.pending,
              }}
            >
              <Label color={colors.pending}>TOTAL PER MONTH</Label>
              <T variant="display">{formatMoney(monthly)}</T>
            </Surface>
          ) : null}

          {/* Added loans. */}
          {views.map((view) => {
            const brand = resolveBrand({ bankId: view.loan.bankId, name: view.loan.name });
            return (
              <Surface key={view.loan.id} padded={false} style={{ padding: space.md }}>
                <Row gap={space.md}>
                  <BankLogo brand={brand} size={40} />
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong" numberOfLines={1}>
                      {view.loan.name}
                    </T>
                    <T variant="caption" tone="muted" numberOfLines={1}>
                      {LOAN_KIND_LABEL[view.loan.kind] ?? 'Loan'} ·{' '}
                      {formatMoney(view.loan.principalMinor, { compact: true })} at{' '}
                      {view.loan.annualRatePct}%
                    </T>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T variant="figure">{formatMoney(view.installmentMinor)}</T>
                    <T variant="caption" tone="muted">
                      / month
                    </T>
                  </View>
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
            onPress={() => setOpen(true)}
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
            <T variant="small" tone="secondary" style={{ fontWeight: '600' }}>
              {views.length > 0 ? 'Add another loan' : 'Add a loan or lease'}
            </T>
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

      {/* New-loan sheet, sharing the Loans tab's form. */}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: colors.canvas }}
        >
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
            <SheetHeader title="New loan" onClose={() => setOpen(false)} />
          </View>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: space.lg, paddingTop: space.md, gap: space.lg }}
            keyboardShouldPersistTaps="handled"
          >
            <LoanForm draft={draft} onChange={setDraft} />
          </ScrollView>
          <PinnedFooter>
            <GradientButton
              label="Add loan"
              icon="add"
              onPress={handleAdd}
              disabled={!isLoanDraftValid(draft)}
            />
          </PinnedFooter>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
