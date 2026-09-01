import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';
import {
  BottomSheet,
  Button,
  Divider,
  Empty,
  GradientButton,
  GradientCard,
  Section,
  Label,
  Row,
  Stat,
  Surface,
  Text,
} from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import { AmountField } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { ImageUploader } from '~/shared/components/ImageUploader';
import {
  daysUntil,
  validateRepayment,
  remainingMinor,
  repaidMinor,
  urgencyOf,
  type BuddyLoanLike,
} from '~/features/buddyloans/logic/buddyLoans';
import type { BuddyRepayment as RepaymentRow } from '~/db/schema';
import { describeDue, STATUS_LABEL } from '~/features/buddyloans/logic/format';
import { formatAmountInput, formatMoney, parseAmount, toMajor, validateAmount } from '~/shared/lib/money';
import { miniAppById } from '~/shared/lib/miniApps';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** The add-on's accent, from the registry — see the note in `edit.tsx`. */
const BUDDY_LOANS = miniAppById('buddyloans')!;

/**
 * One debt in full: what is left, what has come back, and the ways to close it.
 *
 * The three closing actions are deliberately not equal. Logging a repayment is
 * the common case and gets the primary button; settling in full is one tap
 * beside it; writing off is a quiet, destructive-looking action at the bottom,
 * because deciding money is gone should take a moment's thought.
 */
export default function BuddyLoanDetail() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const currency = useAppStore((s) => s.currency);
  const loans = useAppStore((s) => s.buddyLoans);
  const allRepayments = useAppStore((s) => s.buddyRepayments);
  const addBuddyRepayment = useAppStore((s) => s.addBuddyRepayment);
  const deleteBuddyRepayment = useAppStore((s) => s.deleteBuddyRepayment);
  const closeBuddyLoan = useAppStore((s) => s.closeBuddyLoan);
  const reopenBuddyLoan = useAppStore((s) => s.reopenBuddyLoan);

  const loan = useMemo(() => loans.find((l) => l.id === id), [loans, id]);
  const repayments = useMemo<RepaymentRow[]>(
    () => allRepayments.filter((r) => r.loanId === id),
    [allRepayments, id],
  );

  const [logging, setLogging] = useState(false);
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  /*
   * A last-resort fallback, not a screen anyone should reach by deleting.
   *
   * Deleting used to land here for a frame — the row went first and this
   * screen re-rendered against an id that no longer existed. That is fixed at
   * the source (the editor now navigates before it deletes), so what is left
   * is the genuinely odd case: a stale deep link, or a record removed by a
   * restore while this screen sat in the background.
   *
   * It still gets a way OUT. An empty state with no action is a dead end that
   * leaves only the back chevron, and after a restore that chevron can point
   * at another screen showing the same missing record.
   */
  if (!loan) {
    return (
      // The add-on's own name, not a bare "Loan" — with no record to name the
      // screen after, the header should still say where the user is.
      <Screen title="Buddy loans" onBack={() => router.back()}>
        <Empty
          icon="search-outline"
          title="This loan is gone"
          message="It was deleted, or removed when a backup was restored."
          actionLabel="Back to loans"
          onAction={() => router.replace('/mini/buddyloans')}
        />
      </Screen>
    );
  }

  const left = remainingMinor(loan as unknown as BuddyLoanLike, repayments);
  const back = repaidMinor(repayments);
  const open = loan.status === 'outstanding';
  const days = loan.dueOn ? daysUntil(loan.dueOn, new Date()) : null;
  const urgency = days === null ? null : urgencyOf(days);
  const dueColor =
    urgency === 'overdue' ? colors.danger : urgency === 'due_soon' ? colors.pending : colors.inkMuted;

  function confirmWriteOff() {
    Alert.alert(
      'Write this off?',
      'The loan stays in your history as money you did not get back. You will stop getting reminders. You can undo this later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Write off', style: 'destructive', onPress: () => closeBuddyLoan(loan!.id, 'written_off') },
      ],
    );
  }

  return (
    <Screen
      title={loan.personName}
      onBack={() => router.back()}
      action={{
        icon: 'create-outline',
        label: 'Edit',
        onPress: () => router.push(`/mini/buddyloans/edit?id=${loan.id}`),
      }}
    >
      <>
        {/*
          The headline, in the same gradient card the list uses.

          A plain Surface here made the most important figure on the screen look
          like just another row of the details below it.
        */}
        <GradientCard>
          <Row style={{ justifyContent: 'space-between' }} align="center">
            <Label color="rgba(255,255,255,0.65)">
              {open
                ? loan.direction === 'lent'
                  ? 'THEY OWE ME'
                  : 'I OWE THEM'
                : STATUS_LABEL[loan.status].toUpperCase()}
            </Label>
            {open && days !== null ? (
              <View
                style={{
                  paddingHorizontal: space.md,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                }}
              >
                <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '800' }}>
                  {describeDue(days)}
                </Text>
              </View>
            ) : null}
          </Row>

          <Text variant="display" color="#FFFFFF">
            {formatMoney(open ? left : loan.amountMinor)}
          </Text>

          {back > 0 ? (
            <>
              <View
                style={{
                  height: 6,
                  borderRadius: radius.pill,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  overflow: 'hidden',
                  marginTop: space.md,
                }}
              >
                <View
                  style={{
                    width: `${Math.min(100, (back / loan.amountMinor) * 100)}%`,
                    height: '100%',
                    backgroundColor: '#FFFFFF',
                  }}
                />
              </View>
              <Row gap={space.xl} style={{ marginTop: space.md }}>
                <Stat onDark label={loan.direction === 'lent' ? 'I GAVE' : 'I TOOK'} value={formatMoney(loan.amountMinor)} />
                <Stat onDark label="PAID BACK" value={formatMoney(back)} />
              </Row>
            </>
          ) : null}
        </GradientCard>

        <Section title="Details">
          <DetailLine
            label={loan.direction === 'lent' ? 'I gave it on' : 'I took it on'}
            value={formatDate(loan.lentOn)}
          />
          <Divider style={{ marginLeft: space.lg }} />
          <DetailLine
            label={loan.direction === 'lent' ? 'They pay back' : 'I pay back'}
            value={loan.dueOn ? formatDate(loan.dueOn) : 'No date'}
          />
          <Divider style={{ marginLeft: space.lg }} />
          <DetailLine label="How" value={METHOD_LABEL[loan.method]} />
          {loan.closedOn ? (
            <>
              <Divider style={{ marginLeft: space.lg }} />
              <DetailLine label={loan.status === 'paid' ? 'Settled on' : 'Written off'} value={formatDate(loan.closedOn)} />
            </>
          ) : null}
          {loan.note ? (
            <>
              <Divider style={{ marginLeft: space.lg }} />
              <View style={{ padding: space.lg, gap: 4 }}>
                <Label>NOTE</Label>
                <Text variant="body">{loan.note}</Text>
              </View>
            </>
          ) : null}
        </Section>

        {loan.imageUri ? (
          <Pressable onPress={() => setViewingImage(loan.imageUri)} accessibilityRole="button" accessibilityLabel="View photo">
            <Image
              source={{ uri: loan.imageUri }}
              style={{ width: '100%', height: 200, borderRadius: radius.lg, backgroundColor: colors.surfaceSunken }}
              resizeMode="cover"
            />
          </Pressable>
        ) : null}

        <Section title={loan.direction === 'lent' ? 'Money they paid back' : 'Money I paid back'}>
          {repayments.length === 0 ? (
            <View style={{ padding: space.lg }}>
              <Text variant="caption" tone="muted">
                No money paid back yet.
              </Text>
            </View>
          ) : (
            <>
              {repayments.map((repayment, index) => (
                <React.Fragment key={repayment.id}>
                  {index > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                  <Row style={{ justifyContent: 'space-between', padding: space.lg }} gap={space.md}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{formatMoney(repayment.amountMinor)}</Text>
                      <Text variant="caption" tone="muted">
                        {formatDate(repayment.paidOn)}
                        {repayment.note ? ` · ${repayment.note}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        Alert.alert('Remove this repayment?', 'The amount owed will go back up.', [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => deleteBuddyRepayment(repayment.id) },
                        ])
                      }
                      accessibilityRole="button"
                      accessibilityLabel="Remove repayment"
                      hitSlop={8}
                    >
                      <Ionicons name="close" size={18} color={colors.inkMuted} />
                    </Pressable>
                  </Row>
                </React.Fragment>
              ))}
            </>
          )}
        </Section>

        {open ? (
          <View style={{ gap: space.sm }}>
              <GradientButton
              label={loan.direction === 'lent' ? 'They paid me some' : 'I paid some back'}
              onPress={() => setLogging(true)}
            />
            <Button
              label="Fully paid back"
              variant="secondary"
              icon="checkmark-circle-outline"
              onPress={() => closeBuddyLoan(loan.id, 'paid')}
            />
            <Button label="Write off" variant="ghost" onPress={confirmWriteOff} />
          </View>
        ) : (
          <Button
            label="Reopen this loan"
            variant="secondary"
            icon="refresh-outline"
            onPress={() => reopenBuddyLoan(loan.id)}
          />
        )}
      </>

      <LogRepaymentSheet
        visible={logging}
        currency={currency}
        suggested={left}
        onClose={() => setLogging(false)}
        onSave={(amountMinor, paidOn, imageUri, note) => {
          addBuddyRepayment({ loanId: loan.id, amountMinor, paidOn, imageUri, note });
          setLogging(false);
        }}
      />

      {/* `scroll` for the same reason as the repayment sheet: it is what
          supplies the sheet's padding, so the photo is inset rather than
          bleeding to the edges. */}
      <BottomSheet
        visible={viewingImage !== null}
        scroll
        onClose={() => setViewingImage(null)}
        title="Photo"
        icon="image-outline"
        iconColor={BUDDY_LOANS.color}
      >
        {viewingImage ? (
          <Image
            source={{ uri: viewingImage }}
            style={{ width: '100%', height: 420, borderRadius: radius.lg }}
            resizeMode="contain"
          />
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  other: 'Other',
};

function DetailLine({ label, value }: { label: string; value: string }) {
  const { space } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', padding: space.lg }} gap={space.md}>
      <Text variant="body" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </Row>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Log one part payment.
 *
 * Pre-filled with the FULL outstanding balance, because paying the rest is by
 * far the most common case — the user confirms rather than types. Anyone
 * settling part of it edits the figure, which is one field away.
 */
function LogRepaymentSheet({
  visible,
  currency,
  suggested,
  onClose,
  onSave,
}: {
  visible: boolean;
  currency: string;
  suggested: number;
  onClose: () => void;
  onSave: (amountMinor: number, paidOn: Date, imageUri: string | null, note: string | null) => void;
}) {
  const { colors } = useTheme();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(new Date());
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  // Re-seed each time it opens, so a cancelled entry never leaks into the next.
  React.useEffect(() => {
    if (!visible) return;
    /*
     * Seeded through the SAME formatter the field applies to typing.
     *
     * `String(minor / 100)` produced "9000" where every other amount in the app
     * reads "9,000" — the field only reshapes what the user types, so a value
     * put in programmatically bypassed it. `toMajor` also replaces an
     * open-coded `/ 100`, which is the app's one conversion rule and belongs in
     * its helper rather than repeated here.
     */
    setAmount(suggested > 0 ? formatAmountInput(String(toMajor(suggested))) : '');
    setPaidOn(new Date());
    setImageUri(null);
    setShowErrors(false);
  }, [visible, suggested]);

  /*
   * Two checks, not one.
   *
   * `validateAmount` only asks whether the text is a usable figure. It has no
   * idea what this loan is worth, so it happily accepted a repayment ten times
   * the debt — see `validateRepayment`.
   */
  const tooMuchError = validateRepayment(parseAmount(amount) ?? 0, suggested);
  const error = validateAmount(amount) ?? tooMuchError;

  return (
    /*
     * `scroll` and `footer`, like every other sheet in the app.
     *
     * Without `scroll` the chrome renders its children BARE — no padding, no
     * gap — so the fields sat flush against the sheet's edges while every other
     * sheet inset them by `space.lg`. Wrapping them in a `View` with only a
     * `gap` fixed the spacing BETWEEN fields and not the margin around them,
     * which is why it looked half-right.
     *
     * The button moves into `footer` for the same reason it does elsewhere: it
     * pins to the foot of the sheet above the keyboard, rather than scrolling
     * away with the content.
     */
    <BottomSheet
      visible={visible}
      scroll
      onClose={onClose}
      title="Log a repayment"
      icon="cash-outline"
      iconColor={BUDDY_LOANS.color}
      footer={
        <GradientButton
          label="Save repayment"
          icon="checkmark"
          disabled={Boolean(error)}
          onPress={() => {
            if (error) {
              setShowErrors(true);
              return;
            }
            onSave(parseAmount(amount)!, paidOn, imageUri, null);
          }}
        />
      }
    >
      {/*
        The "too much" error shows IMMEDIATELY, not only after a failed save.

        Every other error here is a typo the user can see for themselves — an
        empty field, a stray letter. This one is a fact about a loan they may
        not have in mind, so a disabled button with no stated reason reads as
        the app being broken. `showErrors` still gates the ordinary ones.
      */}
      <AmountField
        value={amount}
        onChangeText={setAmount}
        currency={currency}
        error={showErrors ? error : tooMuchError}
      />
      <DatePickerField label="Paid on" value={paidOn} onChange={setPaidOn} />
      <ImageUploader label="Photo" value={imageUri} onChange={setImageUri} />
    </BottomSheet>
  );
}
