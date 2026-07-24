import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Field, SheetHeader } from '../../src/components/forms';
import { Button, GradientButton, Label, PinnedFooter, Row, Surface, T } from '../../src/components/ui';
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
 * Detail modal for one SMS draft — opened by tapping a row or its "Not this"
 * action on the dashboard. Everything the user needs to resolve the draft lives
 * here, so the dashboard rows stay clean and price-focused:
 *
 *   - see the parsed transaction and the original message
 *   - adjust the amount
 *   - remap it to any bill (a plain searchable list — no auto-filter)
 *   - Log it against the chosen bill, or
 *   - Mark already logged, which just dismisses it (I recorded this by hand)
 */
export default function SmsDraftModal() {
  const { colors, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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

  // The draft may have been resolved on another screen; close cleanly if gone.
  if (!draft) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: space.lg, paddingTop: insets.top + space.xl }}>
        <SheetHeader title="Message" onClose={() => router.back()} />
        <T variant="small" tone="muted" style={{ marginTop: space.lg }}>
          This draft has already been handled.
        </T>
      </View>
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

  // Arrow consts (not hoisted declarations) so TS keeps the non-null narrowing
  // of `draft` from the early return above.
  const logIt = () => {
    state.confirmDraft(draft.id, { subcategoryId, amountMinor });
    router.back();
  };

  const markAlreadyLogged = () => {
    // Nothing is written — the user recorded this by hand; just clear it.
    state.dismissDraft(draft.id);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/* Fixed header sibling; the footer lifts by the keyboard height itself. */}
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg }}>
        <SheetHeader title="Review message" onClose={() => router.back()} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.xl,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
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

        {/* Remap: a plain searchable list of every bill. */}
        <View style={{ gap: space.sm }}>
          <Label>Log against which bill?</Label>

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

        {/* Secondary escape hatch: I already recorded this by hand. */}
        <Button
          label="Mark as already logged"
          icon="checkmark-done-outline"
          variant="ghost"
          onPress={markAlreadyLogged}
        />
      </ScrollView>

      <PinnedFooter followsKeyboard>
        <GradientButton label="Log it" icon="checkmark" onPress={logIt} disabled={!canLog} />
      </PinnedFooter>
    </View>
  );
}
