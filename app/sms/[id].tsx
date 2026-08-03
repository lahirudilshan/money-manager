import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CategoryGridPicker } from '../../src/components/CategoryGridPicker';
import { AmountField, Field } from '../../src/components/forms';
import { BottomSheet, Button, GradientButton, Label, Row, Surface, Text } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { to12Hour } from '../../src/core/dates';
import {
  formatAmountInput,
  formatMoney,
  parseAmount,
  toMajor,
  validateAmount,
} from '../../src/core/money';
import { HINT_META, type CategoryHint } from '../../src/core/smsCategoryHints';
import type { CatalogSuggestion } from '../../src/core/catalogSync';
import {
  findGroupForProposal,
  findLineForHint,
  proposalForHint,
} from '../../src/core/hintCatalog';
import { accountLabelFor } from '../../src/core/smsReconcile';
import {
  categoryNameOf,
  selectDraftTargets,
  useAppStore,
} from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Detail modal for one SMS draft — the screen where the app's category
 * detection is confirmed, corrected, and *taught*.
 *
 * It has two shapes, chosen by how sure the reconciler is (see
 * `SmsDraft.confidence`):
 *
 *   confident (a learned rule recognised this exact merchant, or the score
 *     was strong)  → lead with the suggested category and two actions:
 *     "Yes, that's right" logs it in one tap, "Wrong category" opens the
 *     picker. Either way the merchant→line rule is written, so a confirmed
 *     guess gets stronger and a corrected one is fixed for next time.
 *
 *   unknown (a merchant we've never seen, e.g. the first "F L I TRADING")
 *     → the picker is open from the start, because there is nothing to
 *     confirm; the user's choice is what teaches the system.
 */
export default function SmsDraftModal() {
  const { colors, radius, space } = useTheme();
  const closeModal = useModalClose();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useAppStore();
  const draft = state.smsDrafts.find((d) => d.id === id);

  const subcategories = useMemo(
    () => (draft ? selectDraftTargets(state, draft.id) : []),
    [state, draft],
  );

  // Grid inputs. These must be computed before the "draft already handled" early
  // return below — a draft resolved on another screen while this modal is open
  // re-renders it down that branch, and hooks placed after it would vanish
  // mid-life ("rendered fewer hooks than expected"). Both tolerate an empty
  // `subcategories`, so running them for a missing draft costs nothing.
  //
  // The reconciler's ranking is deliberately not applied: the grid groups by
  // category rather than listing by score, and the ranked suggestion is already
  // surfaced as the confirm card, which is the one-tap path.
  const destinations = useMemo(
    () =>
      subcategories.map((sub) => ({
        id: sub.id,
        name: sub.name,
        categoryId: sub.categoryId,
        plannedMinor: sub.plannedMinor,
        icon: sub.icon,
      })),
    [subcategories],
  );

  // Only categories that actually hold an eligible bill; the grid hides empties
  // itself, but this keeps the array it diffs against small.
  const gridCategories = useMemo(() => {
    const ids = new Set(destinations.map((d) => d.categoryId));
    return state.categories
      .filter((category) => ids.has(category.id))
      .map((category) => ({
        id: category.id,
        name: category.name,
        color: category.color,
        icon: category.icon,
      }));
  }, [destinations, state.categories]);

  const [subcategoryId, setSubcategoryId] = useState(draft?.subcategoryId ?? '');

  /*
   * Pre-filled with the SMS amount, already display-formatted.
   *
   * Kept alongside the editable state so the screen can tell an untouched field
   * from an edited one — see `amountError` below. Formatting it here rather
   * than raw means a large figure reads as "122,867.00" the moment the sheet
   * opens, not only after the first keystroke.
   */
  const initialAmountText = draft ? formatAmountInput(toMajor(draft.amountMinor).toFixed(2)) : '0';
  const [amountText, setAmountText] = useState(initialAmountText);
  // The picker starts collapsed only when there is a real suggestion to
  // confirm; with nothing detected there is nothing to hide behind.
  const [picking, setPicking] = useState(
    !draft?.subcategoryId || draft.confidence === 'unknown',
  );

  // The draft may have been resolved on another screen; close cleanly if gone.
  if (!draft) {
    return (
      <BottomSheet
        visible
      asRoute
        onClose={closeModal}
        title="Message"
        icon="chatbox-ellipses-outline"
        iconColor={colors.accent}
      >
        <Text variant="small" tone="muted">
          This draft has already been handled.
        </Text>
      </BottomSheet>
    );
  }

  const { parsed, hint } = draft;
  const hintMeta = hint ? HINT_META[hint] : null;
  const isCredit = parsed.direction === 'credit';
  const amountMinor = parseAmount(amountText) ?? draft.amountMinor;

  /*
   * Only complain once the field differs from what the SMS said.
   *
   * The amount arrives pre-filled and correct, so flagging an untouched field
   * would greet the user with an error they did not cause. Clearing it to type
   * a new figure is the moment feedback becomes useful.
   */
  const amountError = amountText === initialAmountText ? null : validateAmount(amountText);
  const canLog = subcategoryId !== '' && amountMinor > 0 && !amountError;

  // Shared with the draft card, so a matched account is named identically on the
  // row the user tapped and the screen it opened.
  const accountLabel = accountLabelFor(parsed.account, state.cards);

  const kindLabel = {
    purchase: 'Purchase',
    atm: 'ATM cash',
    transfer_out: 'Transfer out',
    transfer_in: 'Transfer in',
    // See the matching note in SmsDraftCard: a reversal usually cancels its
    // original charge before reaching the UI at all.
    reversal: 'Refund',
    loan_payment: 'Loan payment',
    utility: 'Bill due',
    other: isCredit ? 'Money in' : 'Paid out',
  }[parsed.kind];

  // The suggested line, when the reconciler produced one worth confirming.
  const suggested = subcategories.find((s) => s.id === draft.subcategoryId) ?? null;
  const showConfirmCard = !picking && suggested !== null;

  // Arrow consts (not hoisted declarations) so TS keeps the non-null narrowing
  // of `draft` from the early return above.
  const logIt = () => {
    state.confirmDraft(draft.id, { subcategoryId, amountMinor });
    closeModal();
  };

  /** "Yes, that's right" — accept the suggestion and let the store learn it. */
  const acceptSuggestion = () => {
    if (!suggested) return;
    state.confirmDraft(draft.id, { subcategoryId: suggested.id, amountMinor });
    closeModal();
  };

  /*
   * Crowd suggestions worth OFFERING, which is not the same as all of them.
   *
   * The top suggestion usually agrees with the hint already driving the confirm
   * card above, and repeating it as a "suggestion" makes one answer look like
   * two. So anything matching the current hint is dropped, and what remains are
   * genuine alternatives — the 2nd and 3rd opinions the user asked to see.
   */
  const alternativeSuggestions = draft.suggestions.filter(
    (suggestion) => suggestion.hint !== draft.hint,
  );

  /**
   * Take a crowd suggestion: switch the draft to that hint and let the normal
   * flow continue.
   *
   * It resolves to a LINE the same way detection does — via the hint catalog —
   * because a hint is a category of thing, not a budget line, and only the
   * user's own board can say which line that is. When the board has no home for
   * it, the picker opens with the create-line offer rather than the tap doing
   * nothing.
   */
  const pickSuggestedHint = (hint: CategoryHint) => {
    const existing = findLineForHint(hint, state.subcategories, state.categories);
    if (existing) {
      setSubcategoryId(existing.id);
      setPicking(false);
      return;
    }
    setPicking(true);
  };

  /*
   * The catalog line this message's hint proposes — offered only when the board
   * genuinely lacks somewhere to put it. `findLineForHint` suppresses the offer
   * when a suitable line already exists (including hand-named ones like "CEB
   * bill"), so this never invites the user to duplicate their own board.
   */
  const createTarget = (() => {
    if (!draft.hint) return null;
    if (findLineForHint(draft.hint, state.subcategories, state.categories)) return null;
    return proposalForHint(draft.hint);
  })();

  // Whether the new line joins a group the user already has, or brings a new
  // one with it — worth saying plainly, since the second changes their board
  // structure and the first does not.
  const createTargetGroupExists = createTarget
    ? findGroupForProposal(createTarget, state.categories) !== null
    : false;

  const createAndLog = () => {
    state.createLineForDraft(draft.id, { amountMinor });
    closeModal();
  };

  const markAlreadyLogged = () => {
    // Nothing is written — the user recorded this by hand; just clear it.
    state.dismissDraft(draft.id);
    closeModal();
  };

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Review message"
      icon={(hintMeta?.icon ?? 'chatbox-ellipses-outline') as keyof typeof Ionicons.glyphMap}
      iconColor={colors.accent}
      scroll
      footer={
        showConfirmCard ? (
          // Confident path: the primary action is a single confirming tap, and
          // the correction is one tap away beside it.
          <View style={{ gap: space.sm }}>
            <GradientButton
              label="Yes, that's right"
              icon="checkmark-circle"
              onPress={acceptSuggestion}
            />
            <Button
              label="Wrong category"
              icon="swap-horizontal-outline"
              variant="secondary"
              onPress={() => setPicking(true)}
            />
          </View>
        ) : (
          <GradientButton label="Log it" icon="checkmark" onPress={logIt} disabled={!canLog} />
        )
      }
    >
        {/* Headline: the amount is the focus, with the merchant + account under. */}
        <Surface style={{ gap: space.md }}>
          <Row gap={space.md}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.accentSoft,
              }}
            >
              <Ionicons
                name={(hintMeta?.icon ?? 'chatbox-ellipses-outline') as never}
                size={22}
                color={colors.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {parsed.merchant || kindLabel}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {[
                  hintMeta ? hintMeta.label : kindLabel,
                  accountLabel,
                  // The full ISO date here, not shortWhen's abbreviation: this is
                  // the screen for checking a draft against a statement, so the
                  // year always stays. Only the clock switches to 12-hour, to
                  // match the card.
                  [parsed.date, parsed.time ? to12Hour(parsed.time) : '']
                    .filter(Boolean)
                    .join(' '),
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            </View>
          </Row>

          <View style={{ alignItems: 'center', paddingVertical: space.sm }}>
            <Label>{isCredit ? 'Money in' : 'Amount'}</Label>
            <Text variant="hero" color={isCredit ? colors.completed : colors.ink}>
              {isCredit ? '+ ' : ''}
              {formatMoney(amountMinor, { showDecimals: true })}
            </Text>
          </View>

          <Text variant="caption" tone="muted" style={{ fontStyle: 'italic' }}>
            “{parsed.raw}”
          </Text>
        </Surface>

        {/* The shared money input, so this field formats and validates exactly
            like every other amount in the app. */}
        <AmountField
          label="Amount"
          hero={false}
          currency={state.currency}
          value={amountText}
          onChangeText={setAmountText}
          error={amountError}
        />

        {/* What the system detected, and how sure it is. Shown instead of the
            picker when there is a real suggestion, so the common case is read-
            and-confirm rather than hunt-through-a-list. */}
        {showConfirmCard && suggested ? (
          <DetectedCategoryCard
            confidence={draft.confidence}
            name={suggested.name}
            categoryName={categoryNameOf(state, suggested.id)}
            icon={(hintMeta?.icon ?? 'pricetag-outline') as keyof typeof Ionicons.glyphMap}
          />
        ) : null}

        {/*
          What other users settled on for this merchant, when the crowd offers
          more than the one answer already shown above. Placed between the
          detected card and the full picker because that is the order of effort:
          confirm the guess, else take a near-miss, else hunt the whole board.
        */}
        {alternativeSuggestions.length > 0 ? (
          <CommunitySuggestions
            suggestions={alternativeSuggestions}
            onPick={(suggestion) => pickSuggestedHint(suggestion.hint)}
          />
        ) : null}

        {/* Remap: the category grid over every eligible bill. Hidden behind the
            confirm card until the user says the guess was wrong. */}
        {picking ? (
        <View style={{ gap: space.sm }}>
          <Label>
            {draft.confidence === 'unknown'
              ? 'Which bill is this? (we’ll remember)'
              : 'Log against which bill?'}
          </Label>

          {draft.confidence === 'unknown' ? (
            <Text variant="caption" tone="muted">
              We don’t recognise “{parsed.merchant || 'this merchant'}” yet. Pick the right bill once
              and we’ll detect it automatically next time.
            </Text>
          ) : null}

          {/*
            The hint had no home on the board. Rather than leave the user to
            back out, build the line by hand and lose the draft, offer the
            onboarding-catalog line this hint maps to — one tap creates it,
            logs the message against it, and teaches the merchant rule.
          */}
          {createTarget ? (
            <CreateLineOption
              categoryName={createTarget.category.name}
              lineName={createTarget.subcategory.name}
              icon={createTarget.subcategory.icon}
              existingGroup={createTargetGroupExists}
              onPress={createAndLog}
            />
          ) : null}

          {destinations.length === 0 ? (
            /*
             * A dead end until now: the picker only lists bills that already
             * exist, so a board with none for this direction (income vs
             * expense) showed "add one first" and no way to do it. The button
             * closes this modal and opens the category editor, which is where
             * bills are created.
             */
            <Surface style={{ gap: space.md }}>
              <Text variant="small" tone="muted">
                {createTarget
                  ? 'Or build a different line from scratch.'
                  : 'No bills on your board yet, so there is nowhere to log this.'}
              </Text>
              <Button
                label="Create one"
                icon="add"
                variant="secondary"
                onPress={() => {
                  closeModal();
                  router.push('/category/new');
                }}
              />
            </Surface>
          ) : (
            // The same grid the manual "new transaction" screen uses: categories
            // as tiles that open into their bills. Recognising a tile beats
            // recalling a name into a search box, and it keeps the keyboard off
            // screen — which matters here, where the amount field above is the
            // only thing that should summon it.
            <CategoryGridPicker
              categories={gridCategories}
              destinations={destinations}
              selectedId={subcategoryId || null}
              onSelect={setSubcategoryId}
            />
          )}
        </View>
        ) : null}

        {/* The only escape here: deleting is offered by the × on the dashboard
            card, so repeating it in this modal would be two controls for one
            action. */}
        <Button
          label="Mark as already logged"
          icon="checkmark-done-outline"
          variant="ghost"
          onPress={markAlreadyLogged}
        />

    </BottomSheet>
  );
}

/**
 * The offer to create the line this hint points at — the way out of a detected
 * message with nowhere to go.
 *
 * Presented as a proposal the user accepts rather than something the app did on
 * its own: the group and line are named up front, and whether the group is one
 * they already have is stated, because that is the difference between filing
 * into their board and changing its shape.
 */
function CreateLineOption({
  categoryName,
  lineName,
  icon,
  existingGroup,
  onPress,
}: {
  categoryName: string;
  lineName: string;
  icon: keyof typeof Ionicons.glyphMap;
  existingGroup: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View
      style={{
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
      }}
    >
      <Row gap={6}>
        <Ionicons name="add-circle-outline" size={14} color={colors.accent} />
        <Text variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
          NOTHING ON YOUR BOARD FOR THIS YET
        </Text>
      </Row>

      <Row gap={space.md}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons name={icon} size={21} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {lineName}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {existingGroup ? `Into your ${categoryName}` : `New group · ${categoryName}`}
          </Text>
        </View>
      </Row>

      <Button
        label={`Create "${lineName}" and log it`}
        icon="add"
        variant="secondary"
        onPress={onPress}
      />
    </View>
  );
}

/**
 * The "we think this is X" card — the confident half of the review flow.
 *
 * An `exact` match means a learned rule fired on this precise merchant, so it
 * is presented as recognition ("we've seen this before") rather than a guess;
 * `likely` is honestly labelled as a suggestion. The distinction matters
 * because it tells the user how much to trust the one-tap confirm below.
 */
function DetectedCategoryCard({
  confidence,
  name,
  categoryName,
  icon,
}: {
  confidence: 'exact' | 'likely' | 'unknown';
  name: string;
  categoryName: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { colors, radius, space } = useTheme();
  const isExact = confidence === 'exact';
  const tint = isExact ? colors.completed : colors.accent;

  return (
    <View
      style={{
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        borderColor: tint,
        backgroundColor: isExact ? colors.completedSoft : colors.accentSoft,
      }}
    >
      <Row gap={6}>
        <Ionicons
          name={isExact ? 'sparkles' : 'bulb-outline'}
          size={14}
          color={tint}
        />
        <Text variant="caption" color={tint} style={{ fontWeight: '800' }}>
          {isExact ? 'RECOGNISED — YOU CONFIRMED THIS BEFORE' : 'SUGGESTED CATEGORY'}
        </Text>
      </Row>

      <Row gap={space.md}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons name={icon} size={21} color={tint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {name}
          </Text>
          {categoryName ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {categoryName}
            </Text>
          ) : null}
        </View>
      </Row>
    </View>
  );
}

/**
 * What other users settled on for this merchant.
 *
 * Shown only as ALTERNATIVES — the leading answer is already presented above as
 * the detected category, so repeating it here would make one conclusion look
 * like two independent ones.
 *
 * Confidence is stated as a plain percentage rather than a bar or a star
 * rating: this is a number the user is being asked to judge a suggestion by, and
 * an honest "62%" invites the scepticism a row of four filled stars does not.
 * The count of contributing users is deliberately absent — it would read as
 * authority ("500 people say…") when what matters is the share who agreed.
 */
function CommunitySuggestions({
  suggestions,
  onPick,
}: {
  suggestions: CatalogSuggestion[];
  onPick: (suggestion: CatalogSuggestion) => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Row gap={6}>
        <Ionicons name="people-outline" size={13} color={colors.inkSecondary} />
        <Label>OTHER USERS FILED THIS AS</Label>
      </Row>

      <View style={{ gap: space.sm }}>
        {suggestions.map((suggestion) => {
          const meta = HINT_META[suggestion.hint];
          return (
            <Pressable
              key={suggestion.hint}
              onPress={() => onPick(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={`${meta.label}, ${Math.round(suggestion.confidence * 100)} percent of users`}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.md,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.hairline,
                backgroundColor: colors.surface,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                <Ionicons
                  name={meta.icon as keyof typeof Ionicons.glyphMap}
                  size={17}
                  color={colors.inkSecondary}
                />
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{meta.label}</Text>
                <Text variant="caption" tone="muted">
                  {suggestion.reason === 'sender'
                    ? 'Based on this bank’s other alerts'
                    : suggestion.reason === 'merchant-amount'
                      ? 'Matches this shop and amount'
                      : 'Matches this shop'}
                </Text>
              </View>

              <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                {Math.round(suggestion.confidence * 100)}%
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
