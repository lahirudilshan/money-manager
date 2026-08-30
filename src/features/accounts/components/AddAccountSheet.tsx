import React from 'react';
import { View } from 'react-native';
import { BANKS, type BankBrand } from '~/shared/data/banks';
import { useAppStore } from '~/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { BankSelectTile } from './BankLogo';
import { Field } from '~/shared/components/forms';
import { BottomSheet, GradientButton, Label, Text } from '~/shared/components/ui';

/**
 * Add a bank account from wherever the user discovered they needed one.
 *
 * ## Why this is not the Accounts & Cards form
 *
 * That form collects a card number, CVV, expiry, branch, bank code and opening
 * balance — everything an account HAS. Mid-way through assigning a bill, none
 * of that is to hand and none of it is what the user is trying to answer. The
 * question here is only "which account is this?", so it asks for the bank and
 * the user's own name for it. Everything else keeps its default and stays
 * editable in the full editor.
 *
 * ## Several accounts at one bank
 *
 * Nothing stops a household holding three HNB accounts, and the list would then
 * read "HNB" three times. The nickname is what tells them apart —
 * `accountLabel` leads with it whenever one is set — so this shows how many
 * accounts the chosen bank already has and asks for a name when it matters.
 *
 * The bank grid is `BankSelectTile`, the same control onboarding step 1 uses.
 * Recognising a logo is faster than reading a list of near-identical names, and
 * reusing it means the two places cannot drift apart.
 */
export function AddAccountSheet({
  visible,
  asRoute,
  onClose,
  onAdded,
}: {
  visible: boolean;
  /**
   * Render the chrome WITHOUT its own `<Modal>` wrapper.
   *
   * Set when this is opened from inside another sheet: iOS will not present a
   * modal from within one that is already up, so the caller positions this as
   * an overlay instead and the two stack properly.
   */
  asRoute?: boolean;
  onClose: () => void;
  /** The new account's id, so the caller can select what was just created. */
  onAdded: (createdId: string) => void;
}) {
  const { space } = useTheme();
  const state = useAppStore();

  const [bankId, setBankId] = React.useState<string | null>(null);
  const [nickname, setNickname] = React.useState('');

  /*
   * Cleared each time the sheet opens.
   *
   * It stays mounted between openings, so without this the next "add" would
   * open pre-filled with the last one's bank and name.
   */
  React.useEffect(() => {
    if (!visible) return;
    setBankId(null);
    setNickname('');
  }, [visible]);

  const brand: BankBrand | null = bankId ? (BANKS.find((b) => b.id === bankId) ?? null) : null;

  /*
   * How many accounts this bank already has.
   *
   * A second account at the same bank is exactly when a nickname stops being
   * optional, so the hint changes to say so rather than staying generic.
   */
  const sameBankCount = brand
    ? state.cards.filter((card) => card.bankId === brand.id).length
    : 0;

  function handleAdd() {
    if (!brand) return;

    const created = state.addCard({
      // The bank IS the fallback identity — `accountLabel` leads with it when
      // no nickname is given, so there is nothing to copy into a second field.
      kind: 'bank',
      bankId: brand.id,
      bankName: brand.name,
      nickname: nickname.trim() || null,
      icon: 'wallet-outline',
      sortOrder: state.cards.length,
    });
    onAdded(created.id);
  }

  return (
    <BottomSheet
      visible={visible}
      asRoute={asRoute}
      onClose={onClose}
      title="Add an account"
      icon="add"
      scroll
      /*
       * The nickname sits in the PINNED footer, not in the scroll area.
       *
       * The bank grid is eighteen tiles — taller than the sheet — so a nickname
       * field placed after it is below the fold. The user would pick a bank,
       * see the button light up, and tap it without ever meeting the field that
       * is the whole reason two accounts at one bank can be told apart.
       *
       * `BottomSheet`'s footer is already keyboard-aware, so the field lifts
       * with the keyboard instead of hiding behind it.
       */
      footer={
        <View style={{ gap: space.sm }}>
          <Field
            label="Nickname (optional)"
            value={nickname}
            onChangeText={setNickname}
            placeholder="e.g. Expenses Account, Salary Account"
          />
          <Text variant="caption" tone="muted">
            {sameBankCount > 0
              ? `You already have ${sameBankCount} ${brand?.shortName} account${sameBankCount === 1 ? '' : 's'} — a nickname keeps them apart.`
              : 'Your own name for it. Shown first everywhere in the app.'}
          </Text>
          <GradientButton
            label="Add account"
            icon="checkmark"
            onPress={handleAdd}
            // A bank is what makes the account identifiable at all; the nickname
            // is refinement on top of it.
            disabled={!brand}
          />
        </View>
      }
    >
      <View style={{ gap: space.sm }}>
        <Label>BANK</Label>
        {/*
          Three fixed columns, matching onboarding step 1's grid exactly — see
          the comment there for why the gutters are carried by the columns
          rather than a row `gap`.
        */}
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: space.sm,
            marginHorizontal: -(space.sm / 2),
          }}
        >
          {BANKS.map((option) => (
            <View
              key={option.id}
              style={{
                width: '33.333%',
                paddingHorizontal: space.sm / 2,
                flexGrow: 0,
                flexShrink: 0,
              }}
            >
              <BankSelectTile
                brand={option}
                selected={option.id === bankId}
                onPress={() => setBankId(option.id === bankId ? null : option.id)}
              />
            </View>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}
