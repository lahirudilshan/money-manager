import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { Field } from '../../src/components/forms';
import { BottomSheet, Button, GradientButton, Label, Row, Surface, T } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { formatMoney, parseAmount, toMajor } from '../../src/core/money';
import { HINT_META } from '../../src/core/smsCategoryHints';
import { cardForAccount } from '../../src/core/smsReconcile';
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
  const { id } = useLocalSearchParams<{ id: string }>();

  const state = useAppStore();
  const draft = state.smsDrafts.find((d) => d.id === id);

  const subcategories = useMemo(
    () => (draft ? selectDraftTargets(state, draft.id) : []),
    [state, draft],
  );

  const [subcategoryId, setSubcategoryId] = useState(draft?.subcategoryId ?? '');
  const [amountText, setAmountText] = useState(
    draft ? toMajor(draft.amountMinor).toFixed(2) : '0',
  );
  const [query, setQuery] = useState('');
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
        <T variant="small" tone="muted">
          This draft has already been handled.
        </T>
      </BottomSheet>
    );
  }

  const { parsed, hint } = draft;
  const hintMeta = hint ? HINT_META[hint] : null;
  const isCredit = parsed.direction === 'credit';
  const amountMinor = parseAmount(amountText) ?? draft.amountMinor;
  const canLog = subcategoryId !== '' && amountMinor > 0;

  const matchedCard = cardForAccount(parsed.account, state.cards);
  const accountLabel = matchedCard ? matchedCard.name : parsed.account ? `••${parsed.account}` : '';

  const kindLabel = {
    purchase: 'Purchase',
    atm: 'ATM cash',
    transfer_out: 'Transfer out',
    transfer_in: 'Transfer in',
    loan_payment: 'Loan payment',
    utility: 'Bill due',
    other: isCredit ? 'Money in' : 'Paid out',
  }[parsed.kind];

  // Plain, unfiltered bill list — reconcile's ranking first (best guesses at
  // top), then the rest, narrowed only by the free-text search.
  const bills = useMemo(() => {
    const rankedIds = draft.matches.map((m) => m.subcategoryId);
    const ordered = [
      ...rankedIds
        .map((sid) => subcategories.find((s) => s.id === sid))
        .filter((s): s is (typeof subcategories)[number] => Boolean(s)),
      ...subcategories.filter((s) => !rankedIds.includes(s.id)),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        categoryNameOf(state, s.id).toLowerCase().includes(q),
    );
  }, [draft.matches, subcategories, query, state]);

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
              <T variant="bodyStrong" numberOfLines={2}>
                {parsed.merchant || kindLabel}
              </T>
              <T variant="caption" tone="muted" numberOfLines={1}>
                {[hintMeta ? hintMeta.label : kindLabel, accountLabel, parsed.date]
                  .filter(Boolean)
                  .join('  ·  ')}
              </T>
            </View>
          </Row>

          <View style={{ alignItems: 'center', paddingVertical: space.sm }}>
            <Label>{isCredit ? 'Money in' : 'Amount'}</Label>
            <T variant="hero" color={isCredit ? colors.completed : colors.ink}>
              {isCredit ? '+ ' : ''}
              {formatMoney(amountMinor, { showDecimals: true })}
            </T>
          </View>

          <T variant="caption" tone="muted" style={{ fontStyle: 'italic' }}>
            “{parsed.raw}”
          </T>
        </Surface>

        <Field
          label="Amount"
          value={amountText}
          onChangeText={setAmountText}
          keyboardType="decimal-pad"
          placeholder="0"
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

        {/* Remap: a plain searchable list of every bill. Hidden behind the
            confirm card until the user says the guess was wrong. */}
        {picking ? (
        <View style={{ gap: space.sm }}>
          <Label>
            {draft.confidence === 'unknown'
              ? 'Which bill is this? (we’ll remember)'
              : 'Log against which bill?'}
          </Label>

          {draft.confidence === 'unknown' ? (
            <T variant="caption" tone="muted">
              We don’t recognise “{parsed.merchant || 'this merchant'}” yet. Pick the right bill once
              and we’ll detect it automatically next time.
            </T>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: colors.surfaceSunken,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
            }}
          >
            <Ionicons name="search" size={15} color={colors.inkMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search bills…"
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel="Search bills"
              style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
            />
          </View>

          {bills.length === 0 ? (
            <T variant="small" tone="muted">
              {subcategories.length === 0
                ? 'No matching bills on your board yet — add one first.'
                : 'No bills match your search.'}
            </T>
          ) : (
            <View style={{ gap: 6 }}>
              {bills.map((sub) => {
                const selected = sub.id === subcategoryId;
                return (
                  <Pressable
                    key={sub.id}
                    onPress={() => setSubcategoryId(sub.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingVertical: 12,
                      paddingHorizontal: space.md,
                      borderRadius: radius.md,
                      backgroundColor: selected ? colors.accent : colors.surface,
                      borderWidth: 1,
                      borderColor: selected ? colors.accent : colors.hairline,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <T
                        variant="small"
                        color={selected ? colors.inkInverse : colors.ink}
                        style={{ fontWeight: '600' }}
                        numberOfLines={1}
                      >
                        {sub.name}
                      </T>
                      <T
                        variant="caption"
                        color={selected ? colors.inkInverse : colors.inkMuted}
                        numberOfLines={1}
                      >
                        {categoryNameOf(state, sub.id)} · {formatMoney(sub.plannedMinor)}
                      </T>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={19} color={colors.inkInverse} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
        ) : null}

        {/* Secondary escape hatch: I already recorded this by hand. */}
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
        <T variant="caption" color={tint} style={{ fontWeight: '800' }}>
          {isExact ? 'RECOGNISED — YOU CONFIRMED THIS BEFORE' : 'SUGGESTED CATEGORY'}
        </T>
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
          <T variant="bodyStrong" numberOfLines={1}>
            {name}
          </T>
          {categoryName ? (
            <T variant="caption" tone="muted" numberOfLines={1}>
              {categoryName}
            </T>
          ) : null}
        </View>
      </Row>
    </View>
  );
}
