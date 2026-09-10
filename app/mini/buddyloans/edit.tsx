import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert } from 'react-native';
import { BottomSheet, Button, GradientButton } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import {
  LoanFields,
  useLoanDraft,
} from '~/features/buddyloans/components/LoanFields';
import { miniAppById } from '~/shared/lib/miniApps';
import { useAppStore } from '~/store/useAppStore';

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
  const router = useRouter();
  const closeModal = useModalClose();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const loans = useAppStore((s) => s.buddyLoans);
  const addBuddyLoan = useAppStore((s) => s.addBuddyLoan);
  const updateBuddyLoan = useAppStore((s) => s.updateBuddyLoan);
  const deleteBuddyLoan = useAppStore((s) => s.deleteBuddyLoan);

  const existing = useMemo(() => loans.find((l) => l.id === id), [loans, id]);

  // Every field, its validation and its patch — shared with the SMS review
  // screen, which records a detected transfer as a loan through the same form.
  const draft = useLoanDraft({ existing });

  function save() {
    if (!draft.canSave) {
      draft.setShowErrors(true);
      return;
    }

    const patch = draft.toPatch();
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
          disabled={!draft.canSave}
          onPress={save}
        />
      }
    >
      <>
        <LoanFields draft={draft} existing={existing} />

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
