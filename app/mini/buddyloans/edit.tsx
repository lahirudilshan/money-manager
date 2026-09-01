import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, Button, GradientButton, Label, Segmented, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import {
  outstandingForPerson,
  personColor,
  recentPeople,
  validateLoanAmount,
  type BuddyLoanLike,
  type BuddyRepayment as RepaymentLike,
} from '~/features/buddyloans/logic/buddyLoans';
import { miniAppById } from '~/shared/lib/miniApps';
import { AmountField, Field, NameWithIconField, PillSelect } from '~/shared/components/forms';
import { DatePickerField } from '~/shared/components/DatePickerField';
import { ImageUploader } from '~/shared/components/ImageUploader';
import { formatAmountInput, formatMoney, parseAmount, toMajor, validateAmount } from '~/shared/lib/money';
import { useAppStore } from '~/store/useAppStore';
import { groupColors } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * The add-on's own icon and accent, read from the registry.
 *
 * Every other sheet in the app is tinted by the thing it edits — a category
 * sheet takes the category's colour, a fuel entry takes the vehicle's — so
 * these were the only ones wearing the generic accent blue instead of the
 * purple the add-on is listed under. Read from `miniAppById` rather than
 * repeated as a literal, so the settings row, the dashboard tile and these
 * sheets cannot drift apart.
 */
const BUDDY_LOANS = miniAppById('buddyloans')!;

/**
 * The two directions, coloured by which way the money went.
 *
 * AMBER out, GREEN in. Blue was the app's brand accent, which carries no
 * meaning — it is the colour of buttons and links — so the two halves said
 * nothing beyond "one of these is selected". Warm-against-cool is the pairing
 * people already read as spent-against-received, so the toggle now states the
 * direction before either label is read.
 *
 * Golden yellow rather than red: `danger` is reserved for things that went
 * WRONG, and money you deliberately lent to a friend is not an error. Gold also
 * says "waiting" — money that has gone out and is expected back — which is
 * precisely what a buddy loan is, and it sits warmly beside the green without
 * the muddiness the darker amber had.
 */
const DIRECTIONS = [
  {
    key: 'lent' as const,
    label: 'I gave it',
    icon: 'arrow-up-circle' as const,
    /*
     * Two shades, not one.
     *
     * `tint` washes the card; `ink` writes on it. A single gold did both badly
     * — light enough to sit behind text is too light to BE text, so the label
     * came out pale and the option was hard to read at a glance. The avatars
     * already solve this by pairing a light tile with a full-strength glyph;
     * gold just needs its ink pushed darker than its tint, which green does not.
     */
    tint: '#fe7f73',
    ink: '#ce2a1c',
  },
  {
    key: 'borrowed' as const,
    label: 'I took it',
    icon: 'arrow-down-circle' as const,
    tint: '#10B981',
    ink: '#047857',
  },
];

/**
 * Add or edit one buddy loan.
 *
 * Deliberately short. The whole point of this add-on is that recording a loan
 * takes ten seconds while the money is being handed over — a long form and
 * nobody would ever fill it in, and the record that never gets made is the one
 * that costs the user money.
 *
 * So only three things are required: who, how much, and when it went out. The
 * due date is optional (plenty of these carry no promise), and the photo, the
 * contact and the note are there for the cases that need them.
 */
export default function BuddyLoanEditor() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const currency = useAppStore((s) => s.currency);
  const loans = useAppStore((s) => s.buddyLoans);
  const addBuddyLoan = useAppStore((s) => s.addBuddyLoan);
  const updateBuddyLoan = useAppStore((s) => s.updateBuddyLoan);
  const deleteBuddyLoan = useAppStore((s) => s.deleteBuddyLoan);

  const existing = useMemo(() => loans.find((l) => l.id === id), [loans, id]);

  const [personName, setPersonName] = useState(existing?.personName ?? '');
  const [amount, setAmount] = useState(
    existing ? formatAmountInput(String(toMajor(existing.amountMinor))) : '',
  );
  const [direction, setDirection] = useState<'lent' | 'borrowed'>(existing?.direction ?? 'lent');
  const [method, setMethod] = useState<'cash' | 'transfer' | 'other'>(existing?.method ?? 'cash');
  const [lentOn, setLentOn] = useState<Date>(existing?.lentOn ?? new Date());
  /*
   * A due date is OPT-IN, and the toggle is part of the record rather than
   * inferred from an empty field. "No date agreed" is a real answer here, and a
   * date picker that always shows today quietly turns it into a wrong promise
   * the dashboard would then nag about.
   */
  const [hasDueDate, setHasDueDate] = useState(existing?.dueOn != null);
  const [dueOn, setDueOn] = useState<Date>(existing?.dueOn ?? defaultDueDate());
  const [imageUri, setImageUri] = useState<string | null>(existing?.imageUri ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [showErrors, setShowErrors] = useState(false);
  /*
   * Open by default when EDITING.
   *
   * A new loan is being typed in a hurry, so the optional half starts folded
   * away. Reopening a saved one is almost always to add the thing that was
   * skipped — a photo, a note, the phone number — so hiding them there would
   * make the common case need an extra tap.
   */
  const [showMore, setShowMore] = useState(Boolean(id));

  /*
   * A saved loan that carries any optional value shows them regardless.
   *
   * Folding a field the user has already filled in would hide their own data
   * behind a link they have no reason to tap — worse than showing an empty
   * field, because nothing on screen says the value is still there.
   */
  const hasOptionalValues = Boolean(
    existing?.imageUri || existing?.note,
  );
  const [forceCollapsed, setForceCollapsed] = useState(false);
  const detailsOpen = !forceCollapsed && (showMore || hasOptionalValues);

  /*
   * How much has already come back on this loan.
   *
   * Read here so the amount field can refuse to be edited below it — see
   * `validateLoanAmount`. Empty for a new loan, which has no repayments.
   */
  const alreadyRepaid = useAppStore((s) =>
    s.buddyRepayments.filter((r) => r.loanId === id).reduce((sum, r) => sum + r.amountMinor, 0),
  );

  /*
   * Recent people, each with what they still owe.
   *
   * Computed from the store's own loans and repayments — no extra query, and
   * it stays correct the moment anything is settled.
   */
  const allRepayments = useAppStore((s) => s.buddyRepayments);
  const suggestions = useMemo(() => {
    const byLoan = new Map<string, RepaymentLike[]>();
    for (const r of allRepayments) {
      const bucket = byLoan.get(r.loanId) ?? [];
      bucket.push(r);
      byLoan.set(r.loanId, bucket);
    }

    const source = loans as unknown as BuddyLoanLike[];
    return recentPeople(source).map((name) => ({
      name,
      outstandingMinor: outstandingForPerson(source, byLoan, name),
    }));
  }, [loans, allRepayments]);

  const amountError =
    validateAmount(amount) ?? validateLoanAmount(parseAmount(amount) ?? 0, alreadyRepaid);
  const nameError = personName.trim().length === 0 ? 'Who is this for?' : null;
  const dueError =
    hasDueDate && dueOn.getTime() < startOfDay(lentOn).getTime()
      ? 'The return date must be after the day you gave the money'
      : null;

  const canSave = !amountError && !nameError && !dueError;

  function save() {
    if (!canSave) {
      setShowErrors(true);
      return;
    }

    const patch = {
      personName: personName.trim(),
      amountMinor: parseAmount(amount)!,
      direction,
      method,
      lentOn,
      dueOn: hasDueDate ? dueOn : null,
      imageUri,
      note: note.trim() || null,
    };

    if (existing) updateBuddyLoan(existing.id, patch);
    else addBuddyLoan(patch);

    closeModal();
  }

  function confirmDelete() {
    Alert.alert(
      'Delete this record?',
      'This loan and all its payments will be deleted. You cannot undo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            /*
             * NAVIGATE FIRST, delete second.
             *
             * The other order is what produced a "Not found" screen on every
             * delete: removing the row re-rendered the detail screen sitting
             * underneath this sheet, which then looked up an id that no longer
             * existed and drew its empty state — visible for a frame or two
             * before the replace landed. Leaving the stack first means nothing
             * is mounted to do that lookup.
             *
             * `replace` rather than `dismissAll` + `replace`: one call, and it
             * takes out the sheet AND the detail screen behind it, landing on
             * the list where the record used to be.
             */
            const doomed = existing!.id;
            router.replace('/mini/buddyloans');
            deleteBuddyLoan(doomed);
          },
        },
      ],
    );
  }

  return (
    /*
     * The shared `BottomSheet`, exactly as every other form-in-a-sheet in the
     * app uses it — the fuel fill-up, the health person, the visit, the
     * reading.
     *
     * This screen was built on `Screen` instead, which is the chrome for a
     * PUSHED page: a centred title with a back chevron and no grabber. Rendered
     * into a route registered as `presentation: 'modal'`, it read as a
     * different kind of surface from every other sheet in the app — the one
     * thing the shared modal system exists to prevent.
     */
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title={existing ? 'Edit loan' : 'New loan'}
      icon={BUDDY_LOANS.icon}
      iconColor={BUDDY_LOANS.color}
      footer={
        /*
         * Disabled until the form can actually be saved, the way every other
         * sheet in the app does it — a live button that answers a tap with a
         * red error is a worse signal than one that plainly is not ready yet.
         */
        <GradientButton
          label={existing ? 'Save changes' : 'Add loan'}
          icon="checkmark"
          disabled={!canSave}
          onPress={save}
        />
      }
    >
      <>
        {/*
          The AMOUNT and the DIRECTION together, as one statement.

          These are the two halves of a single fact — "5,000 out" or "5,000 in"
          — and splitting them into a figure and a separate pill row made the
          form open on two questions instead of one. The direction now sits
          right under the figure as a pair of soft cards, so the top of the
          sheet reads as a sentence rather than a control panel.
        */}
        <AmountField
          value={amount}
          onChangeText={setAmount}
          currency={currency}
          autoFocus={!existing}
          error={showErrors ? amountError : null}
        />

        <View
          style={{
            flexDirection: 'row',
            gap: 4,
            padding: 4,
            borderRadius: radius.md,
            backgroundColor: colors.canvas,
          }}
        >
          {DIRECTIONS.map((option) => {
            const selected = direction === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setDirection(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  paddingVertical: 16,
                  borderRadius: radius.md,
                  /*
                   * A TINTED card, not a saturated fill.
                   *
                   * Solid colour made the selected half the loudest thing on
                   * the sheet — louder than the amount above it — and in red it
                   * read as a warning rather than a direction. A soft wash with
                   * the colour carried by the icon and label says the same
                   * thing at a fraction of the volume, and matches how every
                   * other selected surface in the app is treated.
                   *
                   * Taller than a standard row on purpose: this is the first
                   * choice on the form and it takes the weight the old stacked
                   * cards had, without their upload-slot shape.
                   */
                  /*
                   * A light wash of the option's OWN colour, not plain white.
                   *
                   * White-on-grey said "selected" but not "which"; the tint
                   * carries the direction into the whole card so the two halves
                   * differ by more than an outline.
                   */
                  // `18` — the same light wash the person avatars use, so a
                  // selected option reads as tinted rather than filled.
                  backgroundColor: selected ? `${option.tint}18` : 'transparent',
                  borderWidth: 1,
                  borderColor: selected ? `${option.tint}4D` : 'transparent',
                  ...(selected
                    ? {
                        shadowColor: '#000',
                        shadowOpacity: 0.06,
                        shadowRadius: 4,
                        shadowOffset: { width: 0, height: 1 },
                      }
                    : null),
                }}
              >
                <Ionicons
                  name={option.icon}
                  size={19}
                  color={selected ? option.ink : colors.inkMuted}
                />
                {/* `small` rather than `caption`: this is the first decision on
                    the form and was reading as a footnote beside it. */}
                <Text
                  variant="small"
                  color={selected ? option.ink : colors.inkSecondary}
                  style={{ fontWeight: '700', fontSize: 16 }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/*
          The same name-with-icon field a category, vehicle or person uses, so
          the thing being named reads the way every other named thing does.
        */}
        <NameWithIconField
          label="Who"
          value={personName}
          onChangeText={setPersonName}
          icon="person-outline"
          iconColor={BUDDY_LOANS.color}
          placeholder="Their name"
        />
        {showErrors && nameError ? (
          <Text variant="caption" color={colors.danger}>
            {nameError}
          </Text>
        ) : null}

        {/*
          The people you have lent to before, as one-tap chips.

          Lending is repetitive — the same handful of friends and relatives, over
          and over — and the form was making the user retype a name it already
          knew. Each chip carries what that person still owes, so choosing one is
          an informed decision rather than a blind autocomplete: "Kasun · owes
          9,000" is a materially different thing to know before handing over more.

          Only shown on a NEW loan, and only until a name is typed. On an edit the
          person is already settled, and once the user is typing, suggestions
          under their fingers are noise rather than help.
        */}
        {!existing && personName.trim().length === 0 && suggestions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
            keyboardShouldPersistTaps="handled"
          >
            {suggestions.map((person) => (
              <Pressable
                key={person.name}
                onPress={() => setPersonName(person.name)}
                accessibilityRole="button"
                accessibilityLabel={
                  person.outstandingMinor > 0
                    ? `${person.name}, owes ${formatMoney(person.outstandingMinor)}`
                    : person.name
                }
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingLeft: 6,
                  paddingRight: space.md,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
                })}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: `${personColor(person.name, groupColors)}18`,
                  }}
                >
                  <Text
                    variant="caption"
                    color={personColor(person.name, groupColors)}
                    style={{ fontWeight: '800' }}
                  >
                    {person.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text variant="caption" style={{ fontWeight: '700' }}>
                    {person.name}
                  </Text>
                  {person.outstandingMinor > 0 ? (
                    <Text variant="caption" tone="muted">
                      owes {formatMoney(person.outstandingMinor, { compact: true })}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {/*
          The due date as ONE row, not a toggle plus a field.

          "No date" and a picker were two separate controls answering one
          question, which is where a third of the button-wall came from. The
          row now shows the chosen date — or "Not agreed" — and the small
          clear/set affordance sits inside it.
        */}
        <View style={{ gap: space.sm }}>
          <Label>{direction === 'lent' ? 'THEY PAY BACK' : 'I PAY BACK'}</Label>

          {hasDueDate ? (
            <>
              <DatePickerField label="" value={dueOn} onChange={setDueOn} allowFuture />
              {/*
                Worded as the ACTION, not the state.
                
                "No date agreed" sitting under a filled date read as a caption
                describing the field — the opposite of what it does. "Clear the
                date" says what tapping it will do, and the accent marks it as
                something to tap rather than something to read.
              */}
              <Pressable
                onPress={() => setHasDueDate(false)}
                accessibilityRole="button"
                accessibilityLabel="Clear the date"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
              >
                <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                  Clear the date
                </Text>
              </Pressable>
              {showErrors && dueError ? (
                <Text variant="caption" color={colors.danger}>
                  {dueError}
                </Text>
              ) : null}
            </>
          ) : (
            <Pressable
              onPress={() => setHasDueDate(true)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.md,
                paddingVertical: 13,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.hairline,
                backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
              })}
            >
              <Ionicons name="infinite-outline" size={18} color={colors.inkMuted} />
              <Text variant="body" tone="muted" style={{ flex: 1 }}>
                No date agreed
              </Text>
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Set a date
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => {
            const next = !detailsOpen;
            setShowMore(next);
            setForceCollapsed(!next);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 10,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
            {detailsOpen ? 'Fewer details' : 'More details'}
          </Text>
          <Ionicons
            name={detailsOpen ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.accent}
          />
        </Pressable>

        {detailsOpen ? (
          <>
            {/*
              `Segmented` rather than pills.

              Cash/Transfer/Other is a minor setting, not a decision worth a row
              of blue capsules — the segmented control is the app's quieter
              choice and stops this competing with the direction cards above.
            */}
            <View style={{ gap: space.sm }}>
              <Label>HOW</Label>
              <Segmented
                options={[
                  { key: 'cash', label: 'Cash', icon: 'cash-outline' },
                  { key: 'transfer', label: 'Transfer', icon: 'swap-horizontal-outline' },
                  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
                ]}
                selectedKey={method}
                onSelect={(key) => setMethod(key as 'cash' | 'transfer' | 'other')}
              />
            </View>

            <DatePickerField
              label={direction === 'lent' ? 'I gave it on' : 'I took it on'}
              value={lentOn}
              onChange={setLentOn}
            />

            {/* A photo of the slip, the transfer confirmation, or the note they
                wrote — the evidence people actually keep for these. */}
            <ImageUploader label="Photo" value={imageUri} onChange={setImageUri} />

            <Field
              label="Note"
              value={note}
              onChangeText={setNote}
              placeholder="What it was for"
              multiline
            />
          </>
        ) : null}

        {existing ? (
          <Button
            label="Delete this loan"
            variant="danger"
            icon="trash-outline"
            onPress={confirmDelete}
          />
        ) : null}
      </>
    </BottomSheet>
  );
}

/** Midnight on a date, so a same-day comparison is not defeated by the clock. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** A month out — the most common informal promise, and merely a starting point. */
function defaultDueDate(): Date {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return date;
}
