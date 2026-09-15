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
import { useTheme } from '~/shared/theme/ThemeProvider';
import { CURRENCIES } from '~/features/rates/logic/currencies';



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

export default function SettingsScreen() {
  const { colors, space, radius } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
  const enabled = parseEnabled(state.miniApps);
  const resetAllData = useAppStore((s) => s.resetAllData);

  const views = useMemo(() => selectCategoryViews(state), [state]);
  const totals = useMemo(() => selectBoardTotals(state), [state]);

  const [clearing, setClearing] = useState(false);
  const [rateText, setRateText] = useState(String(state.usdRate));
  const [syncing, setSyncing] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState('');

  /*
   * What the rates row shows on the right.
   *
   * The app used to hold ONE rate and could name it ("LKR 323.25"). It now
   * holds a table, and for a board whose foreign money is not dollars the USD
   * figure is irrelevant — so this reports coverage instead, and falls back to
   * naming the headline pair when there is nothing else to say.
   */
  const rateSummary = useMemo(() => {
    const count = Object.keys(state.rates).filter(
      (code) => code !== state.currency.toUpperCase(),
    ).length;
    if (count === 0) return 'Not set';
    return count === 1 ? '1 currency' : `${count} currencies`;
  }, [state.rates, state.currency]);
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
  const [addOnsOpen, setAddOnsOpen] = useState(false);
  const [addOnQuery, setAddOnQuery] = useState('');

  /**
   * Add-ons matching the search, in registry order.
   *
   * Matches name AND description, so the words a feature is known by find it:
   * "gas" and "cylinder" only appear in the Usage tracker's description, and a
   * name-only filter would report no matches for either.
   *
   * Order is never re-ranked by relevance — with four items the list is read
   * whole, and a set that reshuffles as you type is harder to use than one that
   * simply shortens.
   */
  const visibleAddOns = useMemo(() => {
    const q = addOnQuery.trim().toLowerCase();
    if (!q) return MINI_APPS;
    return MINI_APPS.filter(
      (app) =>
        app.name.toLowerCase().includes(q) || app.description.toLowerCase().includes(q),
    );
  }, [addOnQuery]);




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

          Behind ONE row rather than listed inline. Each add-on needs a sentence
          explaining what it does — nobody can judge "Usage tracker" from the
          name — and four of those stacked in the middle of Settings pushed
          every real preference below the fold. The set only grows, so the list
          moved into its own sheet where the descriptions have room.
        */}
        <Section title="ADD-ON FEATURES">
          <SettingRow
            icon="grid-outline"
            color={colors.accent}
            title="Add-ons"
            subtitle="Extra tools for the dashboard"
            /* The count IS the state: "2 on" answers "did I enable that?"
               without opening anything. */
            valueLabel={`${enabled.size} on`}
            onPress={() => setAddOnsOpen(true)}
          />
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
            title="Exchange rates"
            subtitle="Bank rates, and what to plan at"
            /* Counts what the app can actually convert, rather than naming USD
               — a board in AUD holding euros has nothing to do with dollars. */
            valueLabel={rateSummary}
            // Straight to the rates screen. The intermediate sheet restated
            // what that screen already shows, so it was one tap of nothing.
            onPress={() => router.push('/settings/rates')}
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
      {/*
        The add-on picker.

        Each row carries its own sentence, because the name alone does not say
        what the thing is — "Usage tracker" could be almost anything until you
        read that it measures how long a gas cylinder lasts. Inline in Settings
        there was no room for that; here there is.

        Switched ON in place rather than needing a save: the switch IS the
        setting, and a sheet with a confirm button would imply the choice could
        be abandoned, which it cannot — `setMiniAppEnabled` writes immediately.
      */}
      <BottomSheet
        visible={addOnsOpen}
        onClose={() => {
          setAddOnsOpen(false);
          // Cleared on close: a sheet reopening onto a stale filter looks like
          // add-ons have gone missing.
          setAddOnQuery('');
        }}
        title="Add-ons"
        icon="grid-outline"
        iconColor={colors.accent}
        scroll
      >
        {/*
          No padding of its own.

          `BottomSheet`'s scroll container already applies `padding: space.lg`
          on every side plus a `gap` between children, so a wrapper repeating it
          produced 32pt gutters against the sheet's own 16 — and a doubled gap
          under the last card. Only the vertical rhythm between rows is set
          here; the sheet owns the outer frame.
        */}
        <View style={{ gap: space.sm }}>
          {/*
            Search matches the DESCRIPTION as well as the name.
            
            Nobody looking for the gas-cylinder tracker searches "usage" — they
            type "gas", or "cylinder", which only appear in the description. A
            name-only filter would answer "no matches" to the words the feature
            is actually known by.
          */}
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
              value={addOnQuery}
              onChangeText={setAddOnQuery}
              placeholder="Search add-ons…"
              placeholderTextColor={colors.inkMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{ flex: 1, paddingVertical: 11, fontSize: 15, color: colors.ink }}
            />
            {addOnQuery.length > 0 ? (
              <Pressable onPress={() => setAddOnQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={17} color={colors.inkMuted} />
              </Pressable>
            ) : null}
          </View>

          {/*
            A count, not a sentence. The live tally doubles as feedback when a
            switch is flipped, and while searching it reports the match count
            instead — the number the user is looking at.
          */}
          <Row align="center" gap={space.sm} style={{ paddingBottom: space.xs }}>
            <Text variant="small" tone="muted" style={{ flex: 1 }}>
              {addOnQuery.trim()
                ? `${visibleAddOns.length} of ${MINI_APPS.length} shown`
                : `${enabled.size} of ${MINI_APPS.length} on — they appear under Your tools`}
            </Text>
          </Row>

          {visibleAddOns.length === 0 ? (
            <Text variant="small" tone="muted" style={{ paddingVertical: space.lg, textAlign: 'center' }}>
              Nothing matches “{addOnQuery.trim()}”.
            </Text>
          ) : null}

          {visibleAddOns.map((app) => {
            const on = enabled.has(app.id);
            return (
              /*
               * A CARD each, and the whole card is the switch.
               *
               * Four rows sharing one surface read as a settings list, where the
               * eye goes to the switches and the sentences underneath become
               * grey filler. Separating them makes each add-on a thing being
               * offered rather than a line item.
               *
               * Tapping anywhere toggles it: the row is one decision, so
               * requiring the 50pt switch specifically was a target the rest of
               * the card only looked like.
               */
              <Pressable
                key={app.id}
                onPress={() => state.setMiniAppEnabled(app.id, !on)}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${app.name}. ${app.description}`}
                style={({ pressed }) => ({
                  borderRadius: radius.lg,
                  padding: space.md,
                  opacity: pressed ? 0.7 : 1,
                  /*
                   * ON is a filled card in the add-on's own colour; OFF is a
                   * plain surface with a hairline. The difference has to survive
                   * a glance across four of them, which a switch alone did not.
                   */
                  backgroundColor: on ? `${app.color}0D` : colors.surface,
                  borderWidth: 1,
                  borderColor: on ? `${app.color}33` : colors.hairline,
                })}
              >
                <Row gap={space.md} align="center">
                  {/*
                    The same `Glyph` the dashboard uses, so an add-on looks
                    identical wherever it appears. This sheet is where the user
                    CHOOSES a tool and the chosen ones sit under Your tools —
                    two hand-rolled tiles had already drifted to different
                    alphas and radii. Off items grey out.
                  */}
                  <Glyph icon={app.icon} color={on ? app.color : colors.inkMuted} />

                  <View style={{ flex: 1, gap: 3 }}>
                    {/*
                      The check sits on the TITLE line, not beside the whole
                      card. Placed outside, it stole a column from every
                      description — pushing them to three and four lines and
                      leaving the cards at wildly different heights. Here the
                      text runs the full width and the mark still lands where
                      the eye scans for state.
                    */}
                    <Row align="center" gap={space.sm}>
                      <Text variant="body" style={{ flex: 1, fontWeight: '600' }}>
                        {app.name}
                      </Text>
                      {/*
                        The switch is the control people reach for, so it is
                        here as well as the whole-card tap — the card stays
                        tappable for anyone who aims at the name.
                      */}
                      <Switch
                        value={on}
                        onValueChange={(next) => state.setMiniAppEnabled(app.id, next)}
                        accessibilityLabel={`${app.name}, ${on ? 'on' : 'off'}`}
                      />
                    </Row>

                    <Text variant="caption" tone="muted">
                      {app.description}
                    </Text>
                  </View>
                </Row>
              </Pressable>
            );
          })}

          {/*
            Says what switching one OFF does, where the question is actually
            asked. Nothing is deleted — that matters, because a toggle like this
            looks exactly like the kind that would throw the data away.
          */}
          <Row gap={space.sm} align="flex-start" style={{ paddingTop: space.sm }}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.inkMuted} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              Turning one off just hides it. Everything you logged stays, and comes back if you
              switch it on again.
            </Text>
          </Row>
        </View>
      </BottomSheet>

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
