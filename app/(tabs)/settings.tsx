import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet, Button, Divider, Glyph, Label, ListRow, Row, Section, Surface, Text } from '~/shared/components/ui';
import { MINI_APPS, parseEnabled } from '~/shared/lib/miniApps';
import { useTabBarClearance } from '~/shared/components/TabBar';
import { syncCategoryReminders, unavailableReason } from '~/shared/lib/notifications';
import { PinPad } from '~/shared/components/PinPad';
import { SMART_DETECT_NAME } from '~/features/sms/components/SmartDetectBadge';
import { canUse, inheritedPerks, planById, PLANS, type Perk } from '~/features/budget/logic/plans';
import { clearPin, setPin } from '~/shared/lib/appPin';
import {
  canUseBiometrics,
  confirmWithBiometrics,
  describeBiometric,
} from '~/shared/lib/biometrics';
import {
  selectBoardTotals,
  selectCategoryViews,
  useAppStore,
} from '../../src/store/useAppStore';
import { settingsRepo, SETTINGS_KEYS } from '../../src/db/repositories';
import {
  averageRate,
  driftPercent,
  isFetchDue,
  latestRate,
  parseHistory,
  recordRate,
  serialiseHistory,
  type RateMode,
} from '~/shared/lib/exchangeRate';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { useScrollToTopOnFocus } from '~/shared/hooks/useScrollToTopOnFocus';
import { BankLogo } from '~/features/accounts/components/BankLogo';
import { resolveBrand } from '~/shared/data/banks';
import { useSalaryRate } from '~/features/rates/logic/useSalaryRate';


/** Currencies offered, with a symbol and full name for the richer picker. */
const CURRENCIES: { code: string; symbol: string; name: string; flag: string }[] = [
  { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', flag: '🇱🇰' },
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', flag: '🇮🇳' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', flag: '🇦🇺' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', flag: '🇦🇪' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', flag: '🇸🇬' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', flag: '🇯🇵' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', flag: '🇨🇦' },
];

/**
 * The one screen that isn't the plan itself: preferences, the things you
 * manage occasionally (accounts, income, loans), reminders, and the
 * destructive reset. Grouped as a settings list rather than the board's card
 * layout, since these are controls, not data.
 */
/**
 * The three figures the board can convert with, and when each is right.
 *
 * "Safe" leads as the default because the riskier mistake is planning future
 * dollar income at the spot rate: that over-commits the budget the moment the
 * rupee strengthens, whereas a conservative figure merely under-promises.
 */
const RATE_MODES: { key: RateMode; label: string; hint: string }[] = [
  {
    key: 'safe',
    label: 'Safe',
    hint: 'Your own conservative figure — best for planning future income.',
  },
  {
    key: 'average',
    label: 'Average',
    hint: 'The mean of recent readings — smooths out one unusual day.',
  },
  {
    key: 'live',
    label: 'Live',
    hint: 'The latest fetched rate — best for money that already arrived.',
  },
];

export default function SettingsScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  // Every visit starts at the top — a tab screen stays mounted, so its scroll
  // offset otherwise survives being left and returned to. See the hook.
  const scrollRef = useScrollToTopOnFocus();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const enabled = parseEnabled(state.miniApps);
  const resetAllData = useAppStore((s) => s.resetAllData);
  const seedDemoData = useAppStore((s) => s.seedDemoData);

  const views = useMemo(() => selectCategoryViews(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);

  const [clearing, setClearing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rateText, setRateText] = useState(String(state.usdRate));
  const [syncing, setSyncing] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState('');
  /** Which PIN flow is open: setting one to enable the lock, or changing it. */
  const [pinSetup, setPinSetup] = useState<PinPurpose | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  /**
   * What this device actually asks for — "Face ID", "Fingerprint", "Iris"… —
   * resolved at runtime. Never hardcoded: an Android phone has no Face ID, and
   * naming a sensor the user does not have is worse than saying "Biometrics".
   */
  const [biometricLabel, setBiometricLabel] = useState('');
  /** Whether the device can actually authenticate — gates the biometric row. */
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  /**
   * The switch position while a biometric scan is in flight, or null when
   * nothing is pending.
   *
   * The row is otherwise bound to store state, which only flips *after* the
   * scan succeeds — so the switch sat visibly off for the second or two the
   * Face ID sheet was up, as though the tap had not registered. Holding an
   * optimistic value here moves it the instant it is tapped, and clearing it on
   * failure lets the store's real value snap it back.
   *
   * Doubles as the in-flight guard: non-null means a prompt is already up, so
   * the row is disabled and a second tap cannot stack another behind it.
   */
  const [pendingLock, setPendingLock] = useState<boolean | null>(null);

  // Name the enrolled biometric so the row says what will actually be asked
  // for, rather than listing every possibility on every device.
  useEffect(() => {
    void describeBiometric().then(setBiometricLabel);
    // Specifically a *biometric*, not merely a device passcode: the toggle
    // offers Face ID / Touch ID, so a passcode-only phone must read as
    // unavailable rather than enabling a switch that falls through to a
    // passcode prompt the unlock screen is designed to avoid.
    void canUseBiometrics().then(setBiometricsAvailable);
  }, []);
  const [themeOpen, setThemeOpen] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);
  const [autoFetch, setAutoFetch] = useState(
    () => settingsRepo.get(SETTINGS_KEYS.rateAutoFetch) === 'true',
  );
  const [rateMode, setRateMode] = useState<RateMode>(
    () => (settingsRepo.get(SETTINGS_KEYS.rateMode) as RateMode) ?? 'safe',
  );
  const [rateHistory, setRateHistory] = useState(() =>
    parseHistory(settingsRepo.get(SETTINGS_KEYS.rateHistory)),
  );
  const lastFetched = settingsRepo.get(SETTINGS_KEYS.rateFetchedAt) ?? null;

  /*
   * The user's own bank's rate, read from the per-bank cache.
   *
   * Read-only here — the rates screen owns fetching and adopting. This sheet
   * only needs enough to show what their bank actually pays beside the figure
   * the board is using, because that comparison is the reason to open the
   * fuller screen at all.
   */
  const { rate: myBankRate } = useSalaryRate({
    cards: state.cards,
    incomes: state.incomes,
    homeCurrency: state.currency,
    rates: state.bankRates,
  });
  const drift = driftPercent(latestRate(rateHistory), parseFloat(rateText) || 0);

  /** Fetch the live USD→currency rate. Uses a free, key-less endpoint; on any
   * failure the user can still type the rate by hand. */
  /**
   * Fetch and RECORD the live rate.
   *
   * The reading is appended to the stored history rather than only filling the
   * input, which is what makes the average mode possible and lets the user see
   * whether their safe rate has drifted out of touch. `quiet` suppresses the
   * alerts for the automatic daily fetch — a background refresh that fails
   * should not interrupt someone who came to Settings for something else.
   */
  async function fetchRate(quiet = false) {
    setFetchingRate(true);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/USD`);
      const data = await res.json();
      const rate = data?.rates?.[state.currency];

      if (typeof rate === 'number' && rate > 0) {
        const rounded = Math.round(rate * 100) / 100;
        if (!quiet) setRateText(String(rounded));

        const next = recordRate(rateHistory, rounded);
        setRateHistory(next);
        settingsRepo.set(SETTINGS_KEYS.rateHistory, serialiseHistory(next));
        settingsRepo.set(SETTINGS_KEYS.rateFetchedAt, new Date().toISOString());
      } else if (!quiet) {
        Alert.alert('Could not fetch', `No rate available for ${state.currency}. Enter it manually.`);
      }
    } catch {
      if (!quiet) {
        Alert.alert('Could not fetch', 'Check your connection, or enter the rate manually.');
      }
    } finally {
      setFetchingRate(false);
    }
  }

  /*
   * The automatic daily refresh.
   *
   * Guarded by `isFetchDue` so opening Settings repeatedly costs nothing —
   * published rates move on a daily cycle, and refetching per visit would spend
   * the user's data to redraw the same number.
   */
  useEffect(() => {
    if (!autoFetch) return;
    if (!isFetchDue(settingsRepo.get(SETTINGS_KEYS.rateFetchedAt))) return;

    void fetchRate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  async function handleSyncReminders() {
    const blocked = unavailableReason();
    if (blocked) {
      Alert.alert('Reminders unavailable', blocked);
      return;
    }

    setSyncing(true);
    try {
      const reminders = views
        .filter((view) => !view.summary.isFullyFunded)
        .map((view) => ({
          categoryId: view.category.id,
          categoryName: view.category.name,
          shortfallMinor: view.summary.shortfallMinor,
          dueDay: view.category.dueDay,
        }));

      const count = await syncCategoryReminders(reminders);
      Alert.alert(
        count > 0 ? 'Reminders set' : 'Nothing to remind',
        count > 0
          ? `Scheduled ${count} reminder${count === 1 ? '' : 's'} a couple of days before each due date.`
          : unavailableReason() ?? 'Everything is funded, so there is nothing to remind you about.',
      );
    } finally {
      setSyncing(false);
    }
  }

  function handleSaveRate() {
    const parsed = Number.parseFloat(rateText);
    if (Number.isFinite(parsed) && parsed > 0) state.setUsdRate(parsed);
    setRateOpen(false);
  }

  function handleSeedDemo() {
    Alert.alert(
      'Load demo data?',
      'This adds the sample cards, categories, income and loans on top of whatever is already here.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load',
          onPress: () => {
            setSeeding(true);
            try {
              seedDemoData();
            } finally {
              setSeeding(false);
            }
          },
        },
      ],
    );
  }

  /**
   * Turn App Lock on or off.
   *
   * Enabling it on a biometric device **proves the biometric works first**.
   * `canUseBiometrics()` only reports what is enrolled — it does not show that a
   * scan of *this* user will actually succeed. Trusting it meant the switch
   * could turn on for someone whose Face ID never passes, and the next launch
   * would lock them out of their own data with no PIN to fall back on and the
   * switch to undo it sitting behind that same screen. So the prompt runs here,
   * where failing it costs nothing, rather than at the lock screen where it
   * costs everything.
   *
   * A device WITHOUT a biometric routes through PIN setup instead, for the same
   * reason: there must be a proven way in before the door is locked.
   *
   * Turning it off is never gated: someone who has already unlocked the app to
   * reach this screen has cleared the bar the lock sets. Any stored PIN goes
   * with it rather than being left behind in the keystore.
   */
  async function toggleAppLock(next: boolean) {
    if (!next) {
      state.setAppLockEnabled(false);
      await clearPin();
      return;
    }

    if (biometricsAvailable) {
      // Move the switch NOW, before the sheet appears: the tap should look like
      // it landed even though the decision is still a second or two away.
      setPendingLock(true);
      try {
        // `biometricOnly` — the device passcode is not proof the *biometric*
        // works, and the biometric is what the lock screen will ask for.
        const ok = await confirmWithBiometrics(
          `Confirm ${biometricLabel || 'your biometrics'} to turn on App Lock`,
          { biometricOnly: true },
        );

        if (!ok) {
          Alert.alert(
            'App lock not enabled',
            `${biometricLabel || 'Biometric'} could not be confirmed, so the lock was left off. Without a working scan you would have no way back into the app.`,
          );
          return;
        }

        state.setAppLockEnabled(true);
      } finally {
        // Cleared either way. On success the store now says `true` so the
        // switch holds its position; on failure there is nothing behind the
        // optimistic value and it snaps back to off.
        setPendingLock(null);
      }
      return;
    }

    setPinSetup('enable');
  }

  /** Called by the PIN sheet once a PIN is confirmed and stored. */
  function onPinStored(purpose: PinPurpose) {
    if (purpose === 'enable') state.setAppLockEnabled(true);
    setPinSetup(null);
  }

  /**
   * What the App Lock row says once the lock is on.
   *
   * Written from the *user's* side — "You'll need…" — not the app's. "Ask for
   * Face ID to open the app" describes what the software does, which reads like
   * a spec; the user only wants to know what will be required of them.
   */
  const unlockMethodSummary = biometricsAvailable
    ? `You'll need ${biometricLabel || 'biometrics'} to open the app`
    : "You'll need your PIN to open the app";

  /**
   * Confirm once, verify it is really the device's owner, then wipe.
   *
   * The type-DELETE step this replaces was a third hurdle on top of the alert
   * and Face ID, and it guarded nothing the biometric check does not: anyone who
   * can pass Face ID can also type six letters. The prompt is the deliberate
   * pause; the biometric is the actual gate.
   */
  function beginClear() {
    // The wipe is async and the row stays tappable while it runs; without this a
    // second tap would open a second alert over an in-flight reset.
    if (clearing) return;

    Alert.alert(
      'Erase everything?',
      'This permanently deletes every account, category, bill, income, loan, and all history on this device. It cannot be undone, and you will start again from setup.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: async () => {
            const ok = await confirmWithBiometrics('Confirm it is you to erase all data');
            if (!ok) return;
            await confirmClear();
          },
        },
      ],
    );
  }

  async function confirmClear() {
    setClearing(true);
    try {
      // Flips `needsOnboarding`, which the root layout watches — the app routes
      // itself back to the setup flow once this resolves.
      await resetAllData();
    } catch (error) {
      Alert.alert('Could not clear data', error instanceof Error ? error.message : String(error));
    } finally {
      setClearing(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {/*
        Fixed header — stays pinned while the settings scroll beneath it.

        Matches the plan tab, which pins its own header the same way: a hairline
        under a canvas-coloured bar, so content passing behind it has a defined
        edge rather than fading into the same colour.
      */}
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.lg,
          backgroundColor: colors.canvas,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.hairline,
        }}
      >
        <Row justify="space-between" align="center">
          <View style={{ gap: 1 }}>
            <Label>This device</Label>
            <Text variant="title">Settings</Text>
          </View>
        </Row>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{
          paddingTop: space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >

        {/* Your money — what the app manages. */}
        <Section title="YOUR MONEY">
          <SettingRow
            icon="wallet-outline"
            color={colors.accent}
            title="Accounts"
            subtitle={`${state.cards.length} account${state.cards.length === 1 ? '' : 's'}`}
            onPress={() => router.push('/(tabs)/cards')}
          />
          <Divider />
          <SettingRow
            icon="trending-up-outline"
            color={colors.completed}
            title="Income"
            subtitle={`${state.incomes.length} source${state.incomes.length === 1 ? '' : 's'}`}
            onPress={() => router.push('/(tabs)/income')}
          />
          <Divider />
          <SettingRow
            icon="pie-chart-outline"
            color={colors.pending}
            title="Loans"
            subtitle={`${state.loans.length} loan${state.loans.length === 1 ? '' : 's'}`}
            onPress={() => router.push('/(tabs)/loans')}
          />
        </Section>

        {/* Plan — what the current tier is, and what the other one offers. */}
        <Section title="YOUR PLAN">
          {/*
            `diamond` for the paid tier, not `sparkles`.

            Sparkles is this app's Smart Detect mark — on the badge, the draft
            card, and now the Automation section heading. Using it here too made
            one glyph mean both "your subscription" and "the SMS feature", so
            the row read as if it were about Smart Detect rather than billing.
          */}
          <SettingRow
            icon={state.plan === 'premium' ? 'diamond' : 'person-outline'}
            color={colors.accent}
            title={planById(state.plan).name}
            subtitle={planById(state.plan).tagline}
            valueLabel={state.plan === 'premium' ? 'Active' : 'Free'}
            onPress={() => setPlansOpen(true)}
          />
        </Section>

        {/* Automation — the SMS → draft pipeline setup guide. */}
        {/*
          Bordered in the Smart Detect gradient's start colour — the same blue
          the badge opens with — so the section reads as belonging to the
          feature rather than as generic settings. A single flat colour, not the
          gradient: a gradient border would need an extra wrapper view on a card
          whose only job is to hold one row.
        */}
        {/*
          `sparkles` rather than a robot or a chip glyph: it is already the mark
          this app uses for Smart Detect — on the badge, the upgrade sheet and
          the draft card — so reusing it makes the section obviously the same
          feature. A different "AI" icon here would read as a second thing.
        */}
        <Section title="AUTOMATION" accent={colors.gradientStart} icon="sparkles">
          <SettingRow
            icon="chatbox-ellipses-outline"
            color={colors.accent}
            // The Smart Detect gradient, matching its badge — this row opens the
            // setup for that feature, so it should look like it belongs to it.
            gradient={[colors.gradientStart, colors.gradientEnd]}
            title={`Setup ${SMART_DETECT_NAME}`}
            subtitle="Turn incoming bank SMS into drafts"
            valueLabel={canUse(state.plan, 'smartDetect') ? undefined : 'Premium'}
            onPress={() => router.push('/settings/sms-automation')}
          />


          {/*
            No catalog rows here on purpose.

            The shop catalog refreshes itself: at launch, and again whenever the
            app is foregrounded (which is when connectivity has usually come
            back). It never blocks a screen and never asks. A "Update catalog"
            button would only ever be pressed by someone who thought something
            was broken — and pressing it would do exactly what already happened
            a moment ago.
          */}
        </Section>

        {/*
          Optional extras — off by default.

          Everything else on the dashboard earns its place by being about money
          moving this month. A fuel log is genuinely useful to someone who drives
          and pure noise to someone who does not, so these are opt-in rather than
          shipped to everybody with an apology in Settings later.
        */}
        <Section title="ADD-ON FEATURES">
          {MINI_APPS.map((app, index) => {
            const on = enabled.has(app.id);
            return (
              <View key={app.id}>
                {index > 0 ? <Divider /> : null}
                <Row
                  gap={space.md}
                  align="center"
                  style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
                >
                  <Glyph icon={app.icon} color={app.color} />
                  <View style={{ flex: 1 }}>
                    <Text variant="body">{app.name}</Text>
                    <Text variant="caption" tone="muted">
                      {app.description}
                    </Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(next) => state.setMiniAppEnabled(app.id, next)}
                    accessibilityLabel={`${app.name}, ${on ? 'on' : 'off'}`}
                  />
                </Row>
              </View>
            );
          })}
        </Section>

        {/* Preferences. */}
        <Section title="PREFERENCES">
          <SettingRow
            icon="cash-outline"
            color={colors.accent}
            title="Currency"
            subtitle="Symbol shown on every amount"
            valueLabel={state.currency}
            onPress={() => setCurrencyOpen(true)}
          />
          <Divider />
          <SettingRow
            icon="swap-horizontal-outline"
            color={colors.transferred}
            title="USD exchange rate"
            subtitle="Bank rates, and what to plan at"
            valueLabel={`${state.currency} ${state.usdRate}`}
            onPress={() => {
              setRateText(String(state.usdRate));
              setRateOpen(true);
            }}
          />
          <Divider />
          <SettingRow
            icon="notifications-outline"
            color={colors.pending}
            title="Payment reminders"
            subtitle={`Alert before ${totals.categoryCount} categor${totals.categoryCount === 1 ? 'y' : 'ies'} fall due`}
            valueLabel={syncing ? 'Syncing…' : 'Sync'}
            onPress={handleSyncReminders}
          />
        </Section>

        {/* Appearance & feedback. */}
        <Section title="APPEARANCE">
          <SettingRow
            icon="contrast-outline"
            color={colors.accent}
            title="Theme"
            subtitle="Light, dark, or follow the device"
            valueLabel={
              state.themeMode === 'system' ? 'System' : state.themeMode === 'light' ? 'Light' : 'Dark'
            }
            onPress={() => setThemeOpen(true)}
          />
          <Divider />
          <ToggleRow
            icon="phone-portrait-outline"
            color={colors.transferred}
            title="Haptic feedback"
            subtitle="Vibrate on drag and selection"
            value={state.hapticsEnabled}
            onValueChange={state.setHapticsEnabled}
          />
        </Section>

        <Section title="SECURITY">
          {/*
            One switch, and on most devices nothing else. The lock uses whatever
            the phone already authenticates with — a scan, falling back to the
            device passcode — so there is no second secret to configure and no
            options screen to hold them. Only a device with no biometric needs
            the app's own PIN, which is why "Change PIN" appears just there.
          */}
          <ToggleRow
            icon="lock-closed-outline"
            /*
             * Amber, so this and Backup & restore below are told apart.
             *
             * Both were `completed` green, which made two adjacent rows read as
             * one group. Backup keeps the green — a saved copy is the safe
             * state that screen is about — and the lock takes the palette's
             * warm tone, which already means "needs your attention" elsewhere
             * in the app and suits a switch that is off by default.
             */
            color={colors.pending}
            title="App lock"
            /*
             * Both states are plain sentences addressed to the user, so flipping
             * the switch changes one idea rather than swapping between two
             * differently-shaped fragments.
             */
            subtitle={
              state.appLockEnabled
                ? unlockMethodSummary
                : 'Enable App lock security'
            }
            value={pendingLock ?? state.appLockEnabled}
            disabled={pendingLock !== null}
            // The handler may prompt or open PIN setup, so it is async; the
            // Switch wants a void callback. The store update it performs
            // re-renders the row, which is what snaps the switch back if the
            // scan fails.
            onValueChange={(next) => void toggleAppLock(next)}
          />
          {state.appLockEnabled && !biometricsAvailable ? (
            <>
              <Divider />
              <SettingRow
                icon="keypad-outline"
                color={colors.accent}
                title="Change PIN"
                subtitle="The 4 digits that unlock this app"
                onPress={() => setPinSetup('change')}
              />
            </>
          ) : null}
          <Divider />
          {/*
            Backup sits under SECURITY rather than with the automation rows:
            everything lives in one local SQLite file, so this is the only thing
            standing between a lost phone and every transaction the user has
            ever recorded. That is a safety concern, not a convenience feature.
          */}
          <SettingRow
            icon="cloud-upload-outline"
            // Green: a saved backup is the "safe" state this screen is about.
            // App lock above carries the contrasting colour instead — the two
            // rows must not share one, or they read as a single group.
            color={colors.completed}
            title="Backup & restore"
            subtitle="Save your data, or bring it back"
            onPress={() => router.push('/settings/backup')}
          />
        </Section>

        {__DEV__ ? (
          <Section title="DEVELOPER" note="Only visible in dev builds.">
            <SettingRow
              icon="flask-outline"
              color={colors.accent}
              title="Seed demo data"
              subtitle="Loads the sample plan used for development"
              onPress={handleSeedDemo}
              disabled={seeding}
            />
          </Section>
        ) : null}

        <Section
          title="DANGER ZONE"
          note="Everything below acts on the data stored on this device only. There is no cloud backup, so a clear cannot be recovered."
        >
          <SettingRow
            icon="trash-outline"
            color={colors.danger}
            title="Clear all data"
            subtitle="Deletes cards, categories, income, loans and history"
            danger
            onPress={beginClear}
          />
        </Section>

        <View style={{ alignItems: 'center', paddingTop: space.md }}>
          <Text variant="caption" tone="muted">
            {Constants.expoConfig?.name ?? 'Money Manager'}
            {Constants.expoConfig?.version ? ` · v${Constants.expoConfig.version}` : ''}
          </Text>
        </View>
      </ScrollView>

      {plansOpen ? <PlansSheet onClose={() => setPlansOpen(false)} /> : null}

      {/* PIN setup — only ever reached on a device with no biometric, where
          these digits are the single way in. Full-screen so the keypad has the
          height it needs without scrolling under the thumb. */}
      {pinSetup ? (
        <BottomSheet
          visible
          fullScreen
          onClose={() => setPinSetup(null)}
          title={pinSetup === 'enable' ? 'Set a PIN' : 'Change PIN'}
          eyebrow="App lock"
          icon="keypad-outline"
          iconColor={colors.accent}
        >
          <PinSetupBody purpose={pinSetup} onStored={onPinStored} />
        </BottomSheet>
      ) : null}

      {/* USD exchange-rate editor — a bottom sheet with a live rate display, a
          one-tap fetch, and a conversion preview. */}
      <BottomSheet visible={rateOpen} onClose={() => setRateOpen(false)} title="USD exchange rate">
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <Text variant="caption" tone="muted">
            How many {state.currency} one US dollar is worth — used to convert foreign-currency
            income.
          </Text>

          {/* Big live rate. */}
          <Surface style={{ alignItems: 'center', gap: 2, backgroundColor: colors.accentSoft }}>
            <Label color={colors.accent}>1 USD =</Label>
            <Text variant="display" color={colors.accent}>
              {state.currency} {parseFloat(rateText) || 0}
            </Text>
          </Surface>

          {/*
            What the user's OWN bank pays, next to the figure above.

            The rate in this sheet has always been a mid-market number, which
            is not one anybody is paid at — a bank credits its own telegraphic
            transfer buying rate, several rupees lower. Putting the two side by
            side is the whole argument: the difference is money the plan is
            counting on and will not receive.

            Only shown once the per-bank rates have been fetched at least once,
            since a row reading "—" would raise the question without answering
            it. The link below is offered either way.
          */}
          {myBankRate?.ttBuying ? (
            <Pressable
              onPress={() => {
                setRateOpen(false);
                router.push('/settings/rates');
              }}
              accessibilityRole="button"
              accessibilityLabel={`Your bank pays ${myBankRate.ttBuying.toFixed(2)}. See all bank rates.`}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Surface padded={false}>
                <Row gap={space.md} style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                  <BankLogo brand={resolveBrand({ bankName: myBankRate.bankName })} size={32} />
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {myBankRate.bankName}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      What your salary bank actually pays
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="figure" color={colors.accent}>
                      {myBankRate.ttBuying.toFixed(2)}
                    </Text>
                    {/*
                      The shortfall against the figure in use, only when the
                      board is set ABOVE what the bank pays — that is the
                      direction that leaves a plan short, and the only one
                      worth interrupting the user about.
                    */}
                    {(parseFloat(rateText) || 0) > myBankRate.ttBuying ? (
                      <Text variant="caption" color={colors.pending}>
                        {((parseFloat(rateText) || 0) - myBankRate.ttBuying).toFixed(2)} below yours
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
                </Row>
              </Surface>
            </Pressable>
          ) : null}

          {/*
            The route to the full board of banks.

            Kept as a plain secondary action rather than a card: the list is
            reference, consulted when setting the rate or shopping for a better
            bank, not something to act on every time this sheet opens.
          */}
          <Button
            label={myBankRate ? 'See all bank rates' : 'Compare all bank rates'}
            icon="list-outline"
            variant="ghost"
            onPress={() => {
              setRateOpen(false);
              router.push('/settings/rates');
            }}
          />

          <View style={{ gap: space.sm }}>
            <Label>SET RATE</Label>
            <TextInput
              value={rateText}
              onChangeText={setRateText}
              keyboardType="decimal-pad"
              placeholder="300"
              placeholderTextColor={colors.inkMuted}
              style={{
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                borderRadius: 12,
                paddingHorizontal: space.md,
                paddingVertical: 13,
                color: colors.ink,
                fontSize: 20,
                fontWeight: '700',
                textAlign: 'center',
              }}
            />
          </View>

          <Button
            label={fetchingRate ? 'Fetching today’s rate…' : `Fetch live USD → ${state.currency}`}
            icon="cloud-download-outline"
            variant="secondary"
            loading={fetchingRate}
            onPress={() => void fetchRate()}
          />

          {/*
            Keep it current on its own. Guarded to once a day (see
            `isFetchDue`), because published rates move on a daily cycle and
            refetching per launch spends data to redraw the same number.
          */}
          <Surface padded={false} style={{ overflow: 'hidden' }}>
            <Row
              gap={space.md}
              style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
            >
              <Ionicons name="sync-outline" size={19} color={colors.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">Update daily</Text>
                <Text variant="caption" tone="muted">
                  {lastFetched
                    ? `Last checked ${new Date(lastFetched).toLocaleDateString()}`
                    : 'Fetches once a day while the app is open'}
                </Text>
              </View>
              <Switch
                value={autoFetch}
                onValueChange={(next) => {
                  setAutoFetch(next);
                  settingsRepo.set(SETTINGS_KEYS.rateAutoFetch, next ? 'true' : 'false');
                }}
              />
            </Row>
          </Surface>

          {/*
            WHICH figure the board converts with.

            The distinction matters most for planning: someone paid in USD who
            budgets at the spot rate is over-committed the moment the rupee
            strengthens, so "Safe" — their own conservative number — is the
            default rather than the live one.
          */}
          <View style={{ gap: space.sm }}>
            <Label>USE FOR CONVERSIONS</Label>
            <Row gap={6}>
              {RATE_MODES.map((mode) => {
                const active = rateMode === mode.key;
                const value =
                  mode.key === 'live'
                    ? latestRate(rateHistory)
                    : mode.key === 'average'
                      ? averageRate(rateHistory)
                      : parseFloat(rateText) || 0;

                return (
                  <Pressable
                    key={mode.key}
                    onPress={() => {
                      setRateMode(mode.key);
                      settingsRepo.set(SETTINGS_KEYS.rateMode, mode.key);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                      flex: 1,
                      minWidth: 0,
                      alignItems: 'center',
                      gap: 1,
                      paddingVertical: 9,
                      borderRadius: 12,
                      backgroundColor: active ? colors.accent : colors.surface,
                      borderWidth: 1,
                      borderColor: active ? colors.accent : colors.hairline,
                    })}
                  >
                    <Text
                      variant="bodyStrong"
                      color={active ? colors.inkInverse : colors.ink}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {value ? Math.round(value) : '—'}
                    </Text>
                    <Text
                      variant="caption"
                      color={active ? colors.inkInverse : colors.inkMuted}
                      numberOfLines={1}
                    >
                      {mode.label}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
            <Text variant="caption" tone="muted">
              {RATE_MODES.find((mode) => mode.key === rateMode)?.hint}
            </Text>
          </View>

          {/*
            Drift, shown only when it is worth acting on.

            A "safe" rate set months ago and left 20% below spot is not
            conservative — it is out of date, and nothing else on this screen
            would say so.
          */}
          {drift !== null && Math.abs(drift) >= 5 ? (
            <Row gap={space.sm}>
              <Ionicons
                name="trending-up-outline"
                size={16}
                color={drift > 0 ? colors.pending : colors.completed}
              />
              <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
                The live rate is {Math.abs(drift)}% {drift > 0 ? 'above' : 'below'} your saved
                rate.
              </Text>
            </Row>
          ) : null}

          {/* Conversion preview: what $100 becomes. */}
          <Row justify="space-between" style={{ paddingHorizontal: space.xs }}>
            <Text variant="small" tone="muted">
              $100 becomes
            </Text>
            <Text variant="figure">
              {state.currency} {((parseFloat(rateText) || 0) * 100).toLocaleString()}
            </Text>
          </Row>

          <Button label="Save rate" icon="checkmark" onPress={handleSaveRate} />
        </ScrollView>
      </BottomSheet>

      {/* Currency picker — a bottom sheet listing each currency with its symbol,
          flag and full name. */}
      <BottomSheet
        visible={currencyOpen}
        onClose={() => {
          setCurrencyOpen(false);
          setCurrencyQuery('');
        }}
        title="Currency"
      >
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: colors.surfaceSunken,
              borderRadius: 12,
              paddingHorizontal: space.md,
            }}
          >
            <Ionicons name="search" size={16} color={colors.inkMuted} />
            <TextInput
              value={currencyQuery}
              onChangeText={setCurrencyQuery}
              placeholder="Search currency…"
              placeholderTextColor={colors.inkMuted}
              autoCapitalize="characters"
              style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
            />
          </View>
        </View>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          {CURRENCIES.filter((c) => {
            const q = currencyQuery.trim().toLowerCase();
            return !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
          }).map((c) => {
            const selected = c.code === state.currency;
            return (
              <Pressable
                key={c.code}
                onPress={() => {
                  state.setCurrency(c.code);
                  setCurrencyOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingVertical: space.md,
                  paddingHorizontal: space.md,
                  borderRadius: 14,
                  backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceSunken : 'transparent',
                })}
              >
                <Text variant="title" style={{ fontSize: 24 }}>
                  {c.flag}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={selected ? colors.accent : colors.ink}>
                    {c.code} · {c.symbol}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {c.name}
                  </Text>
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>

      {/* Theme picker — a bottom sheet with an icon and description per option. */}
      <BottomSheet visible={themeOpen} onClose={() => setThemeOpen(false)} title="Appearance">
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.xs }}>
          {(
            [
              { key: 'system', label: 'Automatic', desc: 'Follow the device setting', icon: 'phone-portrait-outline' },
              { key: 'light', label: 'Light', desc: 'Always light', icon: 'sunny-outline' },
              { key: 'dark', label: 'Dark', desc: 'Always dark', icon: 'moon-outline' },
            ] as const
          ).map((opt) => {
            const selected = opt.key === state.themeMode;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  state.setThemeMode(opt.key);
                  setThemeOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingVertical: space.md,
                  paddingHorizontal: space.md,
                  borderRadius: 14,
                  borderWidth: 1.5,
                  borderColor: selected ? colors.accent : colors.hairline,
                  backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceSunken : colors.surface,
                })}
              >
                <Ionicons name={opt.icon} size={22} color={selected ? colors.accent : colors.inkSecondary} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" color={selected ? colors.accent : colors.ink}>
                    {opt.label}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {opt.desc}
                  </Text>
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      {/* Clear-all confirmation. */}
    </View>
  );
}



/** A setting row with a native on/off switch instead of a chevron. */
/**
 * The plans on offer, and which one is active.
 *
 * Both tiers are shown side by side rather than only the upsell: a user on
 * Premium should be able to see what they are paying for, and one on Free
 * should see what they already have before what they don't.
 */
function PlansSheet({ onClose }: { onClose: () => void }) {
  const { colors, radius, space } = useTheme();
  const state = useAppStore();

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title="Plans"
      eyebrow="Money Manager"
      icon="pricetags-outline"
      iconColor={colors.accent}
      scroll
    >
      {PLANS.map((plan) => {
        const active = plan.id === state.plan;
        const paid = plan.perks.length > 0 && plan.price !== '';
        const inherited = inheritedPerks(plan.id);

        return (
          <View
            key={plan.id}
            style={{
              borderRadius: radius.lg,
              overflow: 'hidden',
              borderWidth: paid ? 0 : 1,
              borderColor: colors.hairline,
              backgroundColor: colors.surface,
            }}
          >
            {/* The paid tier wears the brand gradient as a header so it reads as
                the upgrade at a glance, rather than as a second identical card
                the user has to compare line by line. */}
            {paid ? (
              <LinearGradient
                colors={[colors.gradientStart, colors.gradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: space.lg, gap: space.sm }}
              >
                <Row justify="space-between" align="center">
                  <Row gap={6}>
                    {/* Same diamond as the YOUR PLAN row, so the sheet and the
                        row it opened from mark the paid tier identically. */}
                    <Ionicons name="diamond" size={15} color="#FFFFFF" />
                    <Text variant="heading" color="#FFFFFF">
                      {plan.name}
                    </Text>
                  </Row>
                  {active ? <CurrentPill onDark /> : null}
                </Row>
                <Text variant="small" color="rgba(255,255,255,0.85)">
                  {plan.tagline}
                </Text>
                <Row gap={4} align="baseline">
                  <Text variant="display" color="#FFFFFF">
                    {plan.price}
                  </Text>
                  <Text variant="small" color="rgba(255,255,255,0.8)">
                    {plan.period}
                  </Text>
                </Row>
              </LinearGradient>
            ) : (
              <View style={{ padding: space.lg, gap: space.sm }}>
                <Row justify="space-between" align="center">
                  <Text variant="heading">{plan.name}</Text>
                  {active ? <CurrentPill /> : null}
                </Row>
                <Text variant="small" tone="muted">
                  {plan.tagline}
                </Text>
                <Text variant="display">Free</Text>
              </View>
            )}

            <View style={{ padding: space.lg, gap: space.md }}>
              {/* A paid tier leads with what it adds, tinted and ticked in the
                  accent, so the reason to upgrade is the first thing read. */}
              {paid ? (
                <Text variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
                  WHAT YOU GET
                </Text>
              ) : null}

              {plan.perks.map((perk) => (
                <PerkRow key={perk.label} perk={perk} highlighted={paid} />
              ))}

              {/* Inherited perks, so the upgrade reads as "everything you
                  already have, plus the above" rather than a rival list. */}
              {inherited.length > 0 ? (
                <>
                  <Divider />
                  <Text variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                    EVERYTHING IN FREE
                  </Text>
                  {inherited.map((perk) => (
                    <PerkRow key={perk.label} perk={perk} muted />
                  ))}
                </>
              ) : null}

              {!active ? (
                <Button
                  label={plan.id === 'free' ? 'Switch to Free' : `Get ${plan.name}`}
                  variant={plan.id === 'free' ? 'secondary' : 'primary'}
                  icon={plan.id === 'free' ? undefined : 'diamond'}
                  onPress={() => {
                    state.setPlan(plan.id);
                    onClose();
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}

      <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        Billing is not connected yet — switching here changes the plan on this device only.
      </Text>
    </BottomSheet>
  );
}

/** "CURRENT" marker on whichever plan is active. */
function CurrentPill({ onDark }: { onDark?: boolean }) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: onDark ? 'rgba(255,255,255,0.25)' : colors.accentSoft,
      }}
    >
      <Text
        variant="caption"
        color={onDark ? '#FFFFFF' : colors.accent}
        style={{ fontWeight: '800' }}
      >
        CURRENT
      </Text>
    </View>
  );
}

/**
 * One perk line. Three weights: highlighted for a paid tier's own additions,
 * plain for a free tier's, muted for ones inherited from below.
 */
function PerkRow({
  perk,
  highlighted,
  muted,
}: {
  perk: Perk;
  highlighted?: boolean;
  muted?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <Row gap={space.sm} align="flex-start">
      <Ionicons
        name={highlighted ? 'sparkles' : 'checkmark-circle'}
        size={16}
        color={highlighted ? colors.accent : muted ? colors.inkMuted : colors.completed}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          variant="small"
          tone={muted ? 'muted' : 'ink'}
          style={{ fontWeight: highlighted ? '700' : '500' }}
        >
          {perk.label}
        </Text>
        {perk.detail && !muted ? (
          <Text variant="caption" tone="muted">
            {perk.detail}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

/** Why the PIN sheet is open — decides the copy and what happens on success. */
type PinPurpose = 'enable' | 'change';

/**
 * Set or change the unlock PIN: enter four digits, then enter them again.
 *
 * Only ever reached on a device with NO biometric enrolled, where these digits
 * are the single way into the app. A phone with Face ID never sees this — it
 * authenticates by scan, falling back to the device's own passcode.
 *
 * The confirm step is not ceremony — on such a device this PIN is the only way
 * back in, and a typo during a one-shot entry would lock the user out of their
 * own data with no recovery path.
 *
 * A *body*, not a sheet: the caller owns the BottomSheet so the presentation
 * (full-screen, for keypad height) is decided in one place.
 */
function PinSetupBody({
  purpose,
  onStored,
}: {
  purpose: PinPurpose;
  onStored: (purpose: PinPurpose) => void;
}) {
  const { colors, space } = useTheme();
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleComplete(entered: string) {
    // First pass: remember it and ask again.
    if (first === null) {
      setFirst(entered);
      setValue('');
      return;
    }

    if (entered !== first) {
      setError('PINs did not match');
      setFirst(null);
      setValue('');
      return;
    }

    const stored = await setPin(entered);
    if (!stored) {
      setError('Could not save the PIN');
      setFirst(null);
      setValue('');
      return;
    }
    onStored(purpose);
  }

  return (
    <>
      {/*
        The whole screen, laid out as three bands: the explanation at the top,
        the keypad centred in the space that remains, and the escape hatch at the
        bottom. The pad is the one thing that must not move or shrink — it is
        operated by thumb, so `flex: 1` goes to the space around it rather than
        to the keys.
      */}
      <View style={{ flex: 1, paddingHorizontal: space.lg }}>
        {/* Step marker + copy. */}
        <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.lg }}>
          {/* Two dashes marking which pass this is. The pad's own dots track the
              digits, so without this the second screen looks identical to the
              first and a mismatch feels like the app lost the entry. */}
          <Row gap={6}>
            {[0, 1].map((step) => {
              const current = first === null ? 0 : 1;
              return (
                <View
                  key={step}
                  style={{
                    width: step === current ? 22 : 8,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: step <= current ? colors.accent : colors.hairlineStrong,
                  }}
                />
              );
            })}
          </Row>

          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accentSoft,
            }}
          >
            <Ionicons
              name={first === null ? 'keypad' : 'checkmark-circle'}
              size={30}
              color={colors.accent}
            />
          </View>

          <View style={{ gap: 6, alignItems: 'center' }}>
            <Text variant="heading">
              {first === null ? 'Choose four digits' : 'Enter them again'}
            </Text>
            <Text variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
              {first === null
                ? 'Your PIN unlocks the app when a biometric scan cannot be used — and on a device without one, it is the only way in.'
                : 'Confirming catches a typo before it locks you out of your own data.'}
            </Text>
          </View>
        </View>

        {/* The pad, centred in whatever height is left. */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <PinPad
            value={value}
            onChange={(next) => {
              setValue(next);
              if (error) setError(null);
            }}
            onComplete={(entered) => void handleComplete(entered)}
            error={error}
          />
        </View>

        {/* One reserved line at the bottom, so the pad above never shifts under
            the thumb. It shows "Start over" mid-entry (the more urgent escape),
            and otherwise the way back to the unlock options when this step is
            running inside the setup sheet. */}
        <View style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
          {first !== null ? (
            <Pressable
              onPress={() => {
                setFirst(null);
                setValue('');
                setError(null);
              }}
              accessibilityRole="button"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                Start over
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </>
  );
}

function ToggleRow({
  icon,
  color,
  title,
  subtitle,
  value,
  onValueChange,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Dims the row and blocks the switch — used when the device cannot honour it. */
  disabled?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        // Dimmed rather than hidden: a missing row cannot explain itself, and
        // "why is Face ID not offered here" is a question the subtitle answers.
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Glyph icon={icon} color={color} />
      {/* Matches ListRow's title/subtitle spacing, so a switch row and a
          tappable row sitting in the same section line up. */}
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" tone="muted">
          {subtitle}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.surfaceSunken, true: colors.accent }}
        thumbColor="#FFFFFF"
        accessibilityLabel={title}
        accessibilityState={{ disabled }}
      />
    </View>
  );
}

/** A single tappable setting row: icon, title/subtitle, optional value + chevron. */
function SettingRow({
  icon,
  color,
  title,
  subtitle,
  valueLabel,
  danger = false,
  disabled = false,
  gradient,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle: string;
  valueLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Brand a row's tile with a gradient — see Glyph. */
  gradient?: readonly [string, string];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <ListRow
      leading={<Glyph icon={icon} color={color} gradient={gradient} />}
      title={title}
      titleColor={danger ? colors.danger : undefined}
      subtitle={subtitle}
      trailing={
        valueLabel ? (
          <Text variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
            {valueLabel}
          </Text>
        ) : undefined
      }
      chevron
      onPress={disabled ? () => {} : onPress}
      accessibilityLabel={`${title}${valueLabel ? `, ${valueLabel}` : ''}`}
    />
  );
}
