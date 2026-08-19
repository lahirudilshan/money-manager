import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { BankSelectTile } from '~/features/accounts/components/BankLogo';
import { FOOTER_CLEARANCE, GradientButton, Label, PinnedFooter, Row, StepHeader, Text } from '~/shared/components/ui';
import { BANKS } from '~/shared/data/banks';
import { useAppStore } from '../../src/store/useAppStore';
import { hydrateOnboardingDraft, useOnboardingDraft } from '~/features/onboarding/logic/useOnboardingDraft';
import { useTheme } from '~/shared/theme/ThemeProvider';

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
  const router = useRouter();
  const state = useAppStore();

  const draft = useOnboardingDraft();

  /*
   * Pre-tick from the saved draft first, then from accounts already created.
   *
   * Both matter and they answer different questions: the draft holds ticks from
   * a session that was interrupted before any account existed, while the cards
   * cover returning to this step after moving on. Preferring the draft means a
   * kill mid-step does not silently drop the banks just ticked.
   */
  const [selected, setSelected] = useState<Set<string>>(() => {
    hydrateOnboardingDraft();
    const savedBanks = useOnboardingDraft.getState().banks;
    return savedBanks.length > 0
      ? new Set(savedBanks)
      : new Set(state.cards.map((card) => card.bankId).filter((id): id is string => Boolean(id)));
  });

  // Mirror into the draft so the ticks survive the app closing.
  React.useEffect(() => {
    draft.setBanks([...selected]);
  }, [selected]);

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

    router.push('/onboarding/about');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
    <StepHeader step={1} title="Where do you bank?">
      Pick every account your money moves through. You can rename them or
      add balances later.
    </StepHeader>

    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        // Clears the pinned footer, which overlays this list. See FOOTER_CLEARANCE.
        paddingBottom: space.lg + FOOTER_CLEARANCE,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <Section title="BANKS" tiles={banks} selected={selected} onToggle={toggle} />
      <Section title="WALLETS & CASH" tiles={wallets} selected={selected} onToggle={toggle} />

    </ScrollView>

    <PinnedFooter>
      <View style={{ gap: space.sm }}>
        <Row justify="center">
          <Text variant="caption" tone="muted">
            {selected.size === 0
              ? 'Select at least one account to continue'
              : `${selected.size} account${selected.size === 1 ? '' : 's'} selected`}
          </Text>
        </Row>
        <GradientButton
          label="Continue"
          icon="arrow-forward"
          onPress={handleContinue}
          disabled={selected.size === 0}
        />
      </View>
    </PinnedFooter>
    </View>
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
      {/*
        Three fixed columns, never growing ones.

        With `flexGrow: 1` a row holding fewer than three tiles shared the whole
        width between them, so a section ending on a single tile — WALLETS &
        CASH now holds just one — stretched that card across all three columns.
        Pinning the column width keeps a short last row aligned to the same grid
        as every full row above it.

        The row has no column gap; each column carries half a gutter on both
        sides instead, which divides evenly however many tiles the last row
        happens to hold. A percentage width plus a `gap` cannot do that — three
        33.33% columns and two gaps overflow the row, dropping a tile to the
        next line.

        The row is then pulled out by that same half-gutter so the outer edges
        of the grid still line up with the screen margin rather than sitting
        half a gap inside it.
      */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          rowGap: space.sm,
          marginHorizontal: -(space.sm / 2),
        }}
      >
        {tiles.map((brand) => (
          <View
            key={brand.id}
            style={{
              width: '33.333%',
              paddingHorizontal: space.sm / 2,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
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
