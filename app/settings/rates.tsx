import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import {
  gapToBest,
  usdNeededFor,
  type BankRate,
  type ResolvedBankRate,
} from '~/features/rates/logic/bankRates';
import { readCachedRates, refreshBankRates } from '~/features/rates/logic/bankRatesApi';
import { useSalaryRate } from '~/features/rates/logic/useSalaryRate';
import {
  BottomSheet,
  Divider,
  Empty,
  GradientCard,
  Label,
  Row,
  Surface,
  Text,
} from '~/shared/components/ui';
import { resolveBrand } from '~/shared/data/banks';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { formatMoney, toMajor } from '~/shared/lib/money';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import { selectAccountTransfers, useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Every Sri Lankan bank's USD rate, with the user's own salary bank called out.
 *
 * ## Why this screen exists
 *
 * The app already had a USD rate, fetched from a mid-market source. That figure
 * is not one anybody is actually paid at: a bank receiving an inward
 * remittance credits its own telegraphic-transfer BUYING rate, which is always
 * below mid-market. At the time of writing the spread across the board was 6.70
 * rupees per dollar — on a USD 3,000 salary that is roughly LKR 20,000 a month
 * between the best bank and the worst.
 *
 * So the screen answers two questions the mid-market rate cannot:
 *
 *   1. **What will MY bank actually give me?** The salary account's bank is
 *      highlighted and pinned into view, because it is the only row the user
 *      has no choice about.
 *   2. **How many dollars do I need to send?** The dashboard states "money to
 *      move" in rupees, but someone paid in dollars holds dollars — the useful
 *      figure is that total divided by the rate they will really get.
 *
 * The rest of the list is context for those two: seeing your bank sit tenth of
 * fourteen is the argument for opening an account somewhere else, and no
 * ranking is legible without the others beside it.
 */
export default function RatesScreen() {
  const { colors, space, radius } = useTheme();
  const closeModal = useModalClose();
  const state = useAppStore();

  /*
   * Seeded from the cache, so the screen renders instantly and offline.
   *
   * A network round trip before the first paint would show a spinner every
   * time for data that changes a few times a day. The cached rows carry their
   * own timestamps and the header says how old they are, so stale figures are
   * presented as stale rather than passed off as current.
   */
  const [rates, setRates] = useState<BankRate[]>(() =>
    readCachedRates(settingsRepo.get(SETTINGS_KEYS.bankRates)),
  );
  const [fetchedAt, setFetchedAt] = useState<string | null>(
    () => settingsRepo.get(SETTINGS_KEYS.bankRatesFetchedAt) ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /*
   * Resolved through the SHARED hook, so this screen, the dashboard and the
   * Settings sheet can never disagree about which bank is the user's or what
   * it pays. `rates` is passed as the cache key: this screen writes new rows
   * on refresh, and the hook reads a settings row that nothing else would
   * announce as changed.
   */
  const { rate: myRate, all: resolved, bankId: myBankId } = useSalaryRate({
    cards: state.cards,
    incomes: state.incomes,
    homeCurrency: state.currency,
    rates,
  });
  const gap = gapToBest(resolved, myBankId);

  /*
   * The dashboard's "money to move", in dollars.
   *
   * Same selector the dashboard itself uses, so the two figures can never
   * disagree — this screen is stating the dashboard's number in another
   * currency, not computing a second opinion about it.
   */
  const accounts = useMemo(() => selectAccountTransfers(state), [state]);
  const toMoveMinor = accounts.reduce((sum, account) => sum + account.toTransferMinor, 0);
  const usdNeeded = myRate?.ttBuying ? usdNeededFor(toMoveMinor, myRate.ttBuying) : null;

  const load = useCallback(
    async (currency: string) => {
      setLoading(true);
      setFailed(false);

      // `force` — opening this screen or tapping refresh is an explicit ask
      // for current figures, so it bypasses the once-a-day guard the launch
      // refresh is subject to.
      const fetched = await refreshBankRates({
        get: (key) => settingsRepo.get(key),
        set: (key, value) => settingsRepo.set(key, value),
        keyRates: SETTINGS_KEYS.bankRates,
        keyFetchedAt: SETTINGS_KEYS.bankRatesFetchedAt,
        force: true,
      });
      if (fetched) {
        setRates(fetched);
        setFetchedAt(settingsRepo.get(SETTINGS_KEYS.bankRatesFetchedAt) ?? null);
        // Push into the store too, so the dashboard's dollar figure follows a
        // refresh made here rather than waiting for the next launch.
        state.refreshSettings();
      } else {
        // Only a FAILURE state when there is nothing to fall back on. With
        // cached rows on screen a failed refresh is a stale caption, not an
        // error — the user still has the answer they came for.
        setFailed(rates.length === 0);
      }
      setLoading(false);
    },
    [rates.length],
  );

  useEffect(() => {
    void load(state.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Bank rates"
      eyebrow="USD → LKR"
      icon="swap-horizontal-outline"
      iconColor={colors.accent}
      scroll
    >
      {/*
        The salary bank and what it pays today — the whole point of the screen.

        Just the rate, not the month's arithmetic: the "how many dollars do I
        send" figure now lives on the dashboard beside the rupee total it
        converts, which is where the user is already looking at that number.
        Repeating it here made this a second, competing answer to a question
        the dashboard had already answered.
      */}
      {myRate?.ttBuying ? (
        /*
          The brand gradient, like every other headline card in the app.

          This is the one figure the screen exists to deliver, and on a plain
          white surface it was indistinguishable from the fourteen list rows
          below it — the same ground, the same weight, just larger. The
          dashboard's balance and the plan's health card both wear the gradient
          for exactly this reason: it marks the card you are meant to read
          first. Reusing it here rather than inventing a treatment also means
          this screen looks like it belongs to the same app.
        */
        <GradientCard>
          {/*
            The gap lives on an inner View, not on `GradientCard`'s style.

            That prop styles the OUTER wrapper, which sits outside the padded
            gradient — a gap there spaces nothing and the children rendered
            flush together inside.
          */}
          <View style={{ gap: space.md }}>
          <Row gap={space.md} align="center">
            {/*
              `onBrand` — the mark now sits on the gradient rather than the
              app's neutral surface, and BankLogo needs telling: a dark
              monogram on a deep blue ground is unreadable, and a white
              logo tile needs its own light backing to not float.
            */}
            <BankLogo brand={resolveBrand({ bankId: myBankId })} size={64} onBrand />

            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Label color="rgba(255,255,255,0.75)">YOUR SALARY BANK</Label>
              <Text variant="bodyStrong" color="#FFFFFF" numberOfLines={1}>
                {myRate.bankName}
              </Text>
              <Text variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
                per US dollar today
              </Text>
            </View>

            {/* `flexShrink: 0` — the rate is the one thing on this row that
                must never be squeezed; a long bank name truncates instead. */}
            <Text variant="display" color="#FFFFFF" style={{ flexShrink: 0 }}>
              {myRate.ttBuying.toFixed(2)}
            </Text>
          </Row>

          {/*
            What the bank's spread costs, only when it is worth acting on.

            A user on the best rate needs no nudge, and one a few cents behind
            has nothing to act on either — moving banks over 0.20 a dollar is
            not advice worth giving. The threshold keeps this quiet until the
            gap is genuinely material.

            On a translucent white panel rather than the amber it used to wear:
            on the gradient, amber-on-blue is muddy, while a wash of white
            reads as a inset panel and lets the text stay legible at caption
            size. The meaning is carried by the words and the arrow.
          */}
          {gap && gap.gap >= 1 ? (
            <Row
              gap={space.sm}
              align="flex-start"
              style={{
                backgroundColor: 'rgba(255,255,255,0.16)',
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
              }}
            >
              <Ionicons name="trending-down-outline" size={16} color="#FFFFFF" />
              <Text variant="caption" color="rgba(255,255,255,0.92)" style={{ flex: 1 }}>
                {gap.best.bankName} pays{' '}
                <Text variant="caption" color="#FFFFFF" style={{ fontWeight: '800' }}>
                  {gap.gap.toFixed(2)}
                </Text>{' '}
                more per dollar
                {usdNeeded !== null
                  ? ` — about ${formatMoney(Math.round(toMajor(usdNeeded) * gap.gap * 100))} on this month's transfer.`
                  : '.'}
              </Text>
            </Row>
          ) : null}
          </View>
        </GradientCard>
      ) : null}

      {/*
        No salary bank known — say what is missing rather than showing a bare
        list with no highlight and letting the user wonder why.
      */}
      {!myRate && resolved.length > 0 ? (
        <Row gap={space.sm} align="flex-start">
          <Ionicons name="information-circle-outline" size={16} color={colors.inkMuted} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Set a USD account with your salary planned against it, and its bank’s rate is
            highlighted here.
          </Text>
        </Row>
      ) : null}

      <Row justify="space-between" align="center">
        <Label>ALL BANKS · TT BUYING</Label>
        {loading ? (
          <ActivityIndicator size="small" color={colors.inkMuted} />
        ) : (
          <Pressable
            onPress={() => void load(state.currency)}
            accessibilityRole="button"
            accessibilityLabel="Refresh rates"
            hitSlop={10}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Ionicons name="refresh" size={16} color={colors.accent} />
          </Pressable>
        )}
      </Row>

      {resolved.length === 0 ? (
        failed ? (
          <Empty
            icon="cloud-offline-outline"
            title="Could not load rates"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => void load(state.currency)}
          />
        ) : (
          <Empty icon="hourglass-outline" title="Loading rates" message="Fetching today’s figures." />
        )
      ) : (
        <Surface padded={false}>
          {resolved.map((rate, index) => (
            <React.Fragment key={rate.bankName}>
              {index > 0 ? <Divider style={{ height: 1, backgroundColor: colors.hairline }} /> : null}
              <BankRateRow
                rate={rate}
                rank={index + 1}
                mine={Boolean(myBankId) && rate.bankId === myBankId}
              />
            </React.Fragment>
          ))}
        </Surface>
      )}

      {/*
        Where the numbers come from, and how old they are.

        An unattributed rate is not checkable — and these are scraped from each
        bank's own page by a third party, so saying whose figures they are lets
        a user who doubts one go and look.
      */}
      <Text variant="caption" tone="muted">
        Telegraphic transfer buying — what a bank pays on an inward USD transfer. Rates via
        ratesdigest.com{fetchedAt ? `, updated ${formatWhen(fetchedAt)}` : ''}.
      </Text>
    </BottomSheet>
  );
}

/**
 * One bank's row.
 *
 * The user's own bank is marked three ways at once — a tinted ground, an
 * accent border and a "Yours" pill — because it is the one row the screen
 * exists to point at, and colour alone would not survive greyscale or a
 * colour-blind reader. No other row is decorated: the list is sorted
 * best-first and numbered, so rank is already legible without a badge.
 */
function BankRateRow({
  rate,
  rank,
  mine,
}: {
  rate: ResolvedBankRate;
  rank: number;
  mine: boolean;
}) {
  const { colors, space, radius } = useTheme();
  const brand = resolveBrand({ bankId: rate.bankId, bankName: rate.bankName });

  return (
    <Row
      gap={space.md}
      style={{
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: mine ? `${colors.accent}14` : 'transparent',
        borderLeftWidth: 3,
        borderLeftColor: mine ? colors.accent : 'transparent',
      }}
    >
      {/* Rank, so "mine is tenth of fourteen" reads without counting rows. */}
      <Text variant="caption" tone="muted" style={{ width: 16 }}>
        {rank}
      </Text>

      <BankLogo brand={brand} size={30} />

      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Row gap={6} align="center">
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {/* The SOURCE's name, not the catalog's: an unmatched bank (Wise)
                has no catalog entry, and a matched one is the same bank either
                way. */}
            {rate.bankName}
          </Text>
          {/* Only "Yours". The list is already sorted best-first and numbered,
              so a "Best" pill on row 1 restated the rank it sits next to. */}
          {mine ? <Pill label="Yours" tone={colors.accent} /> : null}
        </Row>
        {rate.ttSelling ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            sells at {rate.ttSelling.toFixed(2)}
          </Text>
        ) : null}
      </View>

      <Text
        variant="figure"
        color={mine ? colors.accent : colors.ink}
      >
        {/* A bank that publishes no TT rate shows a dash, never a zero — the
            figure is unknown, not nothing. */}
        {rate.ttBuying !== null ? rate.ttBuying.toFixed(2) : '—'}
      </Text>
    </Row>
  );
}

function Pill({ label, tone }: { label: string; tone: string }) {
  const { radius } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: radius.pill,
        backgroundColor: `${tone}1F`,
      }}
    >
      <Text variant="caption" color={tone} style={{ fontWeight: '800' }}>
        {label}
      </Text>
    </View>
  );
}

/** "today", "yesterday", or a date — a rate's age matters more than its clock time. */
function formatWhen(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'recently';

  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return `today ${then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'yesterday';
  return then.toLocaleDateString();
}
