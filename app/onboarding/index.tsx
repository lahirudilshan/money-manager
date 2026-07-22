import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BankSelectTile } from '../../src/components/BankLogo';
import { GradientButton, Label, Row, T } from '../../src/components/ui';
import { BANKS } from '../../src/data/banks';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const KIND_ICON = {
  bank: 'business-outline',
  wallet: 'wallet-outline',
  savings: 'shield-checkmark-outline',
} as const;

/**
 * Onboarding step 1: pick the banks you hold accounts with.
 *
 * Recognition beats recall — tapping familiar brand tiles is far faster and
 * less error-prone than typing account names into a form, which is what this
 * step used to ask for. Each selected brand becomes a card; names and opening
 * balances can be refined later in Settings, so nothing here blocks progress.
 */
export default function OnboardingBanksScreen() {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const state = useAppStore();

  // Pre-tick anything already created, so returning to this step is not a reset.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(state.cards.map((card) => card.bankId).filter((id): id is string => Boolean(id))),
  );

  const banks = useMemo(() => BANKS.filter((bank) => bank.kind === 'bank'), []);
  const wallets = useMemo(() => BANKS.filter((bank) => bank.kind !== 'bank'), []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Reconcile the picked set against existing cards rather than blindly
   * inserting, so stepping back and forth never creates duplicates and
   * un-ticking a bank removes the card it created.
   */
  function handleContinue() {
    const existing = new Map(
      state.cards
        .filter((card) => card.bankId)
        .map((card) => [card.bankId as string, card] as const),
    );

    for (const brand of BANKS) {
      const isPicked = selected.has(brand.id);
      const card = existing.get(brand.id);

      if (isPicked && !card) {
        state.addCard({
          name: brand.shortName,
          bankId: brand.id,
          bankName: brand.name,
          kind: brand.kind,
          icon: KIND_ICON[brand.kind],
          sortOrder: state.cards.length,
        });
      } else if (!isPicked && card) {
        state.deleteCard(card.id);
      }
    }

    router.push('/onboarding/categories');
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: 2 }}>
        <Label>STEP 1 OF 3</Label>
        <T variant="title">Where do you bank?</T>
        <T variant="small" tone="muted">
          Pick every account your money moves through. You can rename them or
          add balances later.
        </T>
      </View>

      <Section title="BANKS" tiles={banks} selected={selected} onToggle={toggle} />
      <Section title="WALLETS & CASH" tiles={wallets} selected={selected} onToggle={toggle} />

      <View style={{ gap: space.sm }}>
        <Row justify="center">
          <T variant="caption" tone="muted">
            {selected.size === 0
              ? 'Select at least one account to continue'
              : `${selected.size} account${selected.size === 1 ? '' : 's'} selected`}
          </T>
        </Row>
        <GradientButton
          label="Continue"
          icon="arrow-forward"
          onPress={handleContinue}
          disabled={selected.size === 0}
        />
      </View>
    </ScrollView>
  );
}

/** A labelled 3-across grid of brand tiles. */
function Section({
  title,
  tiles,
  selected,
  onToggle,
}: {
  title: string;
  tiles: typeof BANKS;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Label>{title}</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {tiles.map((brand) => (
          <View key={brand.id} style={{ flexGrow: 1, flexBasis: '30%' }}>
            <BankSelectTile
              brand={brand}
              selected={selected.has(brand.id)}
              onPress={() => onToggle(brand.id)}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
