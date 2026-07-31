import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { accountLabel, resolveBrand } from '../data/banks';
import type { Card } from '../db/schema';
import { useTheme } from '../theme/ThemeProvider';
import { BankLogo } from './BankLogo';
import { BottomSheet, Text } from './ui';

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
            <Text variant="body" tone="muted" style={{ flex: 1 }}>
              Choose an account
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

  const row = (id: string | null, primary: string, secondary: string | null, card: Card | null) => {
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
        {isSel ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
      </Pressable>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose account">
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
        {allowNone ? row(null, 'No account', 'Not funded from anywhere', null) : null}
        {cards.map((card) => {
          const lbl = accountLabel(card);
          return row(card.id, lbl.primary, lbl.secondary, card);
        })}
      </ScrollView>
    </BottomSheet>
  );
}
