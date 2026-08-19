import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { accountLabel, BANKS, resolveBrand, type BankBrand } from '~/shared/data/banks';
import type { Card } from '~/db/schema';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { BankLogo } from './BankLogo';
import { Field } from '~/shared/components/forms';
import { BottomSheet, GradientButton, Row, Text } from '~/shared/components/ui';

/**
 * A single tappable row showing the currently-chosen funding account (bank
 * colour, bank name primary, the user's custom name secondary) that opens the
 * shared account-picker sheet. Use this EVERYWHERE an account is chosen, so the
 * "funded from / paid into" control looks and behaves identically across the
 * app (category edit, new bill, income, transfers…).
 */
export function AccountField({
  label = 'Funded account',
  cards,
  selectedId,
  onSelect,
  allowNone = false,
}: {
  label?: string;
  cards: readonly Card[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Offer a "No account" choice at the top of the picker. */
  allowNone?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = React.useState(false);
  const selected = cards.find((c) => c.id === selectedId) ?? null;

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" tone="muted">
        {label.toUpperCase()}
      </Text>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected ? accountLabel(selected).primary : 'choose'}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.md,
          paddingVertical: 11,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        })}
      >
        {selected ? (
          <>
            <BankLogo
              brand={resolveBrand({
                bankId: selected.bankId,
                bankName: selected.bankName,
                name: selected.name,
              })}
              size={30}
            />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {accountLabel(selected).primary}
              </Text>
              {accountLabel(selected).secondary ? (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {accountLabel(selected).secondary}
                </Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Ionicons name="wallet-outline" size={22} color={colors.inkMuted} />
            {/* Names the next step when there is nothing to choose from yet —
                "Choose an account" on an empty list is an instruction the user
                cannot follow. */}
            <Text variant="body" tone="muted" style={{ flex: 1 }}>
              {cards.length === 0 ? 'Add an account' : 'Choose an account'}
            </Text>
          </>
        )}
        <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
      </Pressable>

      <AccountPickerSheet
        visible={open}
        cards={cards}
        selectedId={selectedId}
        allowNone={allowNone}
        onSelect={(id) => {
          onSelect(id);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

/** The picker sheet on its own, for callers that manage their own trigger. */
export function AccountPickerSheet({
  visible,
  cards,
  selectedId,
  onSelect,
  onClose,
  allowNone = false,
}: {
  visible: boolean;
  cards: readonly Card[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
  allowNone?: boolean;
}) {
  const { colors, radius, space } = useTheme();

  /*
   * The add/rename editor.
   *
   * `null` closed, `'new'` adding, otherwise the id of the card being renamed.
   */
  const [editing, setEditing] = React.useState<string | null>(null);

  const row = (
    id: string | null,
    primary: string,
    secondary: string | null,
    card: Card | null,
  ) => {
    const isSel = id === selectedId;

    return (
      <Pressable
        key={id ?? '__none__'}
        onPress={() => onSelect(id)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSel }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingVertical: space.md,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          backgroundColor: isSel ? colors.accentSoft : pressed ? colors.surfaceSunken : 'transparent',
        })}
      >
        {card ? (
          <BankLogo
            brand={resolveBrand({ bankId: card.bankId, bankName: card.bankName, name: card.name })}
            size={34}
          />
        ) : (
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceSunken,
            }}
          >
            <Ionicons name="remove-circle-outline" size={18} color={colors.inkMuted} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" color={isSel ? colors.accent : colors.ink} numberOfLines={1}>
            {primary}
          </Text>
          {secondary ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {secondary}
            </Text>
          ) : null}
        </View>

        {/*
          Renaming, right where the accounts are listed.

          Two accounts at the same bank are otherwise indistinguishable here —
          "HNB" twice — and the nickname is the only thing that tells them
          apart. Sending the user to the Cards tab to set it would abandon
          whatever form this picker was opened from.
        */}
        {card ? (
          <Pressable
            onPress={() => setEditing(card.id)}
            accessibilityRole="button"
            accessibilityLabel={`Rename ${primary}`}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: space.xs })}
          >
            <Ionicons name="pencil" size={16} color={colors.inkMuted} />
          </Pressable>
        ) : null}

        {isSel ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
      </Pressable>
    );
  };

  /*
   * The editor is a STEP INSIDE this sheet, not a sheet of its own.
   *
   * `BottomSheet` presents a native modal, and iOS will not present a second
   * one from inside a modal that is already up — nesting them made the pencil
   * and "Add an account" silently do nothing. Swapping the content (and turning
   * the header icon into a back button, which `BottomSheet` supports for
   * exactly this) keeps it to one presentation and reads as going deeper rather
   * than stacking.
   */
  if (editing !== null) {
    return (
      <AccountEditorSheet
        visible={visible}
        mode={editing}
        cards={cards}
        onBack={() => setEditing(null)}
        onClose={() => {
          setEditing(null);
          onClose();
        }}
        onSaved={(id) => {
          setEditing(null);
          // A freshly added account is almost certainly the one being chosen —
          // selecting it saves a second tap and closes the picker. A rename is
          // not a choice, so it leaves the selection alone.
          if (id) onSelect(id);
        }}
      />
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose account">
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        {allowNone ? row(null, 'No account', 'Not funded from anywhere', null) : null}
        {cards.map((card) => {
          const lbl = accountLabel(card);
          return row(card.id, lbl.primary, lbl.secondary, card);
        })}

        {/*
          Adding an account, from the place you discover you need one.

          The picker used to be a dead end: someone setting up their salary with
          no accounts yet saw an empty sheet, and the only way forward was to
          guess that Accounts & Cards existed on another tab, add one there, and
          come back.

          It now opens an editor in place instead of routing to the Cards tab.
          Leaving mid-form to add an account abandons whatever was being filled
          in — and the full editor asks for a card number, CVV, branch and
          balance that nobody has to hand while assigning a bill. This collects
          only what distinguishes one account from another; the rest stays
          editable in Accounts & Cards.
        */}
        {cards.length > 0 ? <View style={{ height: space.xs }} /> : null}
        <Pressable
          onPress={() => setEditing('new')}
          accessibilityRole="button"
          accessibilityLabel="Add an account"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.md,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
          })}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accentSoft,
            }}
          >
            <Ionicons name="add" size={20} color={colors.accent} />
          </View>
          <Text variant="bodyStrong" color={colors.accent} style={{ flex: 1 }}>
            Add an account
          </Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * Add a new account, or rename an existing one, without leaving the picker.
 *
 * Deliberately NOT a copy of the Accounts & Cards form. That one collects a
 * card number, CVV, expiry, branch, bank code and opening balance — everything
 * an account has. Here the question is only "which account is this?", so it
 * asks for the bank, the user's own name for it, and the last four digits.
 * Everything else keeps its default and stays editable in the full editor.
 *
 * The nickname is the point: several accounts at the SAME bank are common, and
 * "HNB" three times is unusable. `accountLabel` leads with the nickname when
 * one is set, so naming one "Salary" makes it identifiable everywhere at once.
 */
function AccountEditorSheet({
  visible,
  mode,
  cards,
  onBack,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** `'new'` when adding, otherwise the id being renamed. */
  mode: string;
  cards: readonly Card[];
  /** Return to the account list without closing the whole sheet. */
  onBack: () => void;
  onClose: () => void;
  /** Called with the new card's id when one was created, else null. */
  onSaved: (createdId: string | null) => void;
}) {
  const { colors, radius, space } = useTheme();
  const state = useAppStore();

  const isNew = mode === 'new';
  const existing = isNew ? null : (cards.find((card) => card.id === mode) ?? null);

  /*
   * Seeded once on mount, which is enough: the parent renders this only while
   * an edit is in progress, so a new session is a fresh mount and cannot
   * inherit the previous account's details.
   */
  const [bankId, setBankId] = React.useState<string | null>(existing?.bankId ?? null);
  const [nickname, setNickname] = React.useState(existing?.nickname ?? '');
  const [last4, setLast4] = React.useState(existing?.last4 ?? '');

  const brand: BankBrand | null = bankId ? (BANKS.find((b) => b.id === bankId) ?? null) : null;

  // A new account needs a bank to be identifiable at all; a rename already has
  // one, so a nickname alone is enough to save.
  const canSave = isNew ? Boolean(brand) : true;

  function handleSave() {
    if (!canSave) return;
    const cleanNickname = nickname.trim() || null;
    const cleanLast4 = last4.replace(/\D/g, '').slice(-4) || null;

    if (existing) {
      state.updateCard(existing.id, { nickname: cleanNickname, last4: cleanLast4 });
      onSaved(null);
      return;
    }

    if (!brand) return;
    const created = state.addCard({
      // The bank's short name is the fallback identity; the nickname is what
      // the lists actually lead with when it is set.
      name: brand.shortName,
      kind: 'bank',
      bankId: brand.id,
      bankName: brand.name,
      nickname: cleanNickname,
      last4: cleanLast4,
      icon: 'wallet-outline',
      sortOrder: cards.length,
    });
    onSaved(created.id);
  }

  /*
   * How many accounts this bank already has.
   *
   * Shown while adding, because a second account at the same bank is the case
   * where a nickname stops being optional — without one the picker would list
   * the same name twice.
   */
  const sameBankCount = brand ? cards.filter((card) => card.bankId === brand.id).length : 0;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      // The leading icon becomes a BACK button, so this reads as a step further
      // into the picker rather than a new sheet on top of it.
      onBack={onBack}
      title={existing ? 'Rename account' : 'Add an account'}
      icon={existing ? 'pencil' : 'add'}
      scroll
      footer={
        <GradientButton
          label={existing ? 'Save name' : 'Add account'}
          icon="checkmark"
          onPress={handleSave}
          disabled={!canSave}
        />
      }
    >
      {isNew ? (
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            BANK
          </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {BANKS.filter((b) => b.kind === 'bank' || b.id === 'cash' || b.id === 'other').map(
            (option) => {
              const selected = option.id === bankId;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setBankId(option.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.name}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    alignItems: 'center',
                    gap: 4,
                    width: 68,
                    paddingVertical: space.sm,
                    borderRadius: radius.md,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? option.color : colors.hairline,
                    backgroundColor: selected ? `${option.color}12` : colors.surface,
                  })}
                >
                  <BankLogo brand={option} size={32} />
                  <Text
                    variant="caption"
                    numberOfLines={2}
                    color={selected ? colors.ink : colors.inkMuted}
                    style={{ textAlign: 'center', fontWeight: selected ? '700' : '500' }}
                  >
                    {option.shortName}
                  </Text>
                </Pressable>
              );
            },
          )}
          </View>
        </View>
      ) : (
        existing && (
          <Row gap={space.md}>
            <BankLogo
              brand={resolveBrand({
                bankId: existing.bankId,
                bankName: existing.bankName,
                name: existing.name,
              })}
              size={36}
            />
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {existing.bankName ?? existing.name}
            </Text>
          </Row>
        )
      )}

      <Field
        label="Nickname"
        value={nickname}
        onChangeText={setNickname}
        placeholder="e.g. Expenses Account, Salary Account"
      />
      <Text variant="caption" tone="muted" style={{ marginTop: -space.xs }}>
        {sameBankCount > 0
          ? `You already have ${sameBankCount} ${brand?.shortName} account${sameBankCount === 1 ? '' : 's'} — a nickname keeps them apart.`
          : 'Your own name for it. Shown first everywhere in the app.'}
      </Text>

      <Field
        label="Last 4 digits (optional)"
        value={last4}
        onChangeText={(text) => setLast4(text.replace(/\D/g, '').slice(0, 4))}
        placeholder="4150"
        keyboardType="numeric"
      />

    </BottomSheet>
  );
}
