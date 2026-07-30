import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet, Button, Divider, Glyph, Label, ListRow, Row, ScreenHeader, Section, Surface, T } from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { syncCategoryReminders, unavailableReason } from '../../src/services/notifications';
import { PinPad } from '../../src/components/PinPad';
import { SMART_DETECT_NAME } from '../../src/components/SmartDetectBadge';
import { canUse, inheritedPerks, planById, PLANS, type Perk } from '../../src/core/plans';
import { clearPin, setPin } from '../../src/services/appPin';
import { confirmWithBiometrics, describeBiometric } from '../../src/services/biometrics';
import {
  selectBoardTotals,
  selectCategoryViews,
  useAppStore,
} from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';


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
export default function SettingsScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const state = useAppStore();
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
  /** "Face ID" / "Touch ID" / "" — drives the App Lock row's subtitle. */
  const [biometricLabel, setBiometricLabel] = useState('');

  // Name the enrolled biometric so the row says what will actually be asked
  // for, rather than listing every possibility on every device.
  useEffect(() => {
    void describeBiometric().then(setBiometricLabel);
  }, []);
  const [themeOpen, setThemeOpen] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);

  /** Fetch the live USD→currency rate. Uses a free, key-less endpoint; on any
   * failure the user can still type the rate by hand. */
  async function fetchRate() {
    setFetchingRate(true);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/USD`);
      const data = await res.json();
      const rate = data?.rates?.[state.currency];
      if (typeof rate === 'number' && rate > 0) {
        setRateText(String(Math.round(rate * 100) / 100));
      } else {
        Alert.alert('Could not fetch', `No rate available for ${state.currency}. Enter it manually.`);
      }
    } catch {
      Alert.alert('Could not fetch', 'Check your connection, or enter the rate manually.');
    } finally {
      setFetchingRate(false);
    }
  }

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
   * Turn App Lock on only once there is a way back in.
   *
   * A PIN is always required, even on a phone with Face ID: biometrics fail —
   * wet hands, a mask, a failed re-enrolment — and without a fallback the lock
   * screen would be a dead end, with the switch to undo it sitting behind that
   * same screen. So enabling always routes through PIN setup, and the lock is
   * only switched on once the PIN is stored.
   *
   * Turning it *off* is deliberately not gated: someone who has already unlocked
   * the app to reach this screen has cleared the bar the lock sets. The PIN is
   * cleared with it rather than left in the keystore.
   */
  async function enableAppLock(next: boolean) {
    if (!next) {
      state.setAppLockEnabled(false);
      await clearPin();
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
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.canvas }}
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: tabClearance,
          paddingHorizontal: space.lg,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader eyebrow="This device" title="Settings" />

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
          <SettingRow
            icon={state.plan === 'premium' ? 'sparkles' : 'person-outline'}
            color={colors.accent}
            title={planById(state.plan).name}
            subtitle={planById(state.plan).tagline}
            valueLabel={state.plan === 'premium' ? 'Active' : 'Free'}
            onPress={() => setPlansOpen(true)}
          />
        </Section>

        {/* Automation — the SMS → draft pipeline setup guide. */}
        <Section title="AUTOMATION">
          <SettingRow
            icon="chatbox-ellipses-outline"
            color={colors.accent}
            title={SMART_DETECT_NAME}
            subtitle="Turn incoming bank SMS into drafts"
            valueLabel={canUse(state.plan, 'smartDetect') ? undefined : 'Premium'}
            onPress={() => router.push('/settings/sms-automation')}
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
            title="USD exchange rate"
            subtitle="For foreign-currency income"
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

        <Section title="SECURITY" note="Locks the app when it is opened or resumed.">
          <ToggleRow
            icon="lock-closed-outline"
            color={colors.completed}
            title="App lock"
            subtitle={
              state.appLockEnabled
                ? biometricLabel
                  ? `${biometricLabel} or your PIN`
                  : 'Your PIN'
                : 'Require unlocking before the app opens'
            }
            value={state.appLockEnabled}
            // The handler prompts, so it is async; the Switch wants a void
            // callback. The store update it performs re-renders the row.
            onValueChange={(next) => void enableAppLock(next)}
          />
          {state.appLockEnabled ? (
            <>
              <Divider />
              <SettingRow
                icon="keypad-outline"
                color={colors.accent}
                title="Change PIN"
                subtitle="The 4 digits used when unlocking fails"
                onPress={() => setPinSetup('change')}
              />
            </>
          ) : null}
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
          <T variant="caption" tone="muted">
            {Constants.expoConfig?.name ?? 'Money Manager'}
            {Constants.expoConfig?.version ? ` · v${Constants.expoConfig.version}` : ''}
          </T>
        </View>
      </ScrollView>

      {plansOpen ? <PlansSheet onClose={() => setPlansOpen(false)} /> : null}

      {pinSetup ? (
        <PinSetupSheet
          purpose={pinSetup}
          onClose={() => setPinSetup(null)}
          onStored={onPinStored}
        />
      ) : null}

      {/* USD exchange-rate editor — a bottom sheet with a live rate display, a
          one-tap fetch, and a conversion preview. */}
      <BottomSheet visible={rateOpen} onClose={() => setRateOpen(false)} title="USD exchange rate">
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md }}
          keyboardShouldPersistTaps="handled"
        >
          <T variant="caption" tone="muted">
            How many {state.currency} one US dollar is worth — used to convert foreign-currency
            income.
          </T>

          {/* Big live rate. */}
          <Surface style={{ alignItems: 'center', gap: 2, backgroundColor: colors.accentSoft }}>
            <Label color={colors.accent}>1 USD =</Label>
            <T variant="display" color={colors.accent}>
              {state.currency} {parseFloat(rateText) || 0}
            </T>
          </Surface>

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
            onPress={fetchRate}
          />

          {/* Conversion preview: what $100 becomes. */}
          <Row justify="space-between" style={{ paddingHorizontal: space.xs }}>
            <T variant="small" tone="muted">
              $100 becomes
            </T>
            <T variant="figure">
              {state.currency} {((parseFloat(rateText) || 0) * 100).toLocaleString()}
            </T>
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
                <T variant="title" style={{ fontSize: 24 }}>
                  {c.flag}
                </T>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong" color={selected ? colors.accent : colors.ink}>
                    {c.code} · {c.symbol}
                  </T>
                  <T variant="caption" tone="muted">
                    {c.name}
                  </T>
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
                  <T variant="bodyStrong" color={selected ? colors.accent : colors.ink}>
                    {opt.label}
                  </T>
                  <T variant="caption" tone="muted">
                    {opt.desc}
                  </T>
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.accent} /> : null}
              </Pressable>
            );
          })}
        </View>
      </BottomSheet>

      {/* Clear-all confirmation. */}
    </>
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
                    <Ionicons name="sparkles" size={15} color="#FFFFFF" />
                    <T variant="heading" color="#FFFFFF">
                      {plan.name}
                    </T>
                  </Row>
                  {active ? <CurrentPill onDark /> : null}
                </Row>
                <T variant="small" color="rgba(255,255,255,0.85)">
                  {plan.tagline}
                </T>
                <Row gap={4} align="baseline">
                  <T variant="display" color="#FFFFFF">
                    {plan.price}
                  </T>
                  <T variant="small" color="rgba(255,255,255,0.8)">
                    {plan.period}
                  </T>
                </Row>
              </LinearGradient>
            ) : (
              <View style={{ padding: space.lg, gap: space.sm }}>
                <Row justify="space-between" align="center">
                  <T variant="heading">{plan.name}</T>
                  {active ? <CurrentPill /> : null}
                </Row>
                <T variant="small" tone="muted">
                  {plan.tagline}
                </T>
                <T variant="display">Free</T>
              </View>
            )}

            <View style={{ padding: space.lg, gap: space.md }}>
              {/* A paid tier leads with what it adds, tinted and ticked in the
                  accent, so the reason to upgrade is the first thing read. */}
              {paid ? (
                <T variant="caption" color={colors.accent} style={{ fontWeight: '800' }}>
                  WHAT YOU GET
                </T>
              ) : null}

              {plan.perks.map((perk) => (
                <PerkRow key={perk.label} perk={perk} highlighted={paid} />
              ))}

              {/* Inherited perks, so the upgrade reads as "everything you
                  already have, plus the above" rather than a rival list. */}
              {inherited.length > 0 ? (
                <>
                  <Divider />
                  <T variant="caption" tone="muted" style={{ fontWeight: '700' }}>
                    EVERYTHING IN FREE
                  </T>
                  {inherited.map((perk) => (
                    <PerkRow key={perk.label} perk={perk} muted />
                  ))}
                </>
              ) : null}

              {!active ? (
                <Button
                  label={plan.id === 'free' ? 'Switch to Free' : `Get ${plan.name}`}
                  variant={plan.id === 'free' ? 'secondary' : 'primary'}
                  icon={plan.id === 'free' ? undefined : 'sparkles'}
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

      <T variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        Billing is not connected yet — switching here changes the plan on this device only.
      </T>
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
      <T
        variant="caption"
        color={onDark ? '#FFFFFF' : colors.accent}
        style={{ fontWeight: '800' }}
      >
        CURRENT
      </T>
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
        <T
          variant="small"
          tone={muted ? 'muted' : 'ink'}
          style={{ fontWeight: highlighted ? '700' : '500' }}
        >
          {perk.label}
        </T>
        {perk.detail && !muted ? (
          <T variant="caption" tone="muted">
            {perk.detail}
          </T>
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
 * The confirm step is not ceremony — this PIN may be the only way back into the
 * app, and a typo during a one-shot entry would lock the user out of their own
 * data with no recovery path.
 */
function PinSetupSheet({
  purpose,
  onClose,
  onStored,
}: {
  purpose: PinPurpose;
  onClose: () => void;
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
    <BottomSheet
      visible
      onClose={onClose}
      title={purpose === 'enable' ? 'Set a PIN' : 'Change PIN'}
      eyebrow="App lock"
      icon="keypad-outline"
      iconColor={colors.accent}
    >
      <View style={{ alignItems: 'center', gap: space.lg, paddingVertical: space.md }}>
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

        <View style={{ gap: 4, alignItems: 'center' }}>
          <T variant="bodyStrong">
            {first === null ? 'Choose four digits' : 'Enter them again'}
          </T>
          <T variant="caption" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
            {first === null
              ? 'You will need these if Face ID or Touch ID cannot be used.'
              : 'Confirming catches a typo before it locks you out.'}
          </T>
        </View>

        <PinPad
          value={value}
          onChange={(next) => {
            setValue(next);
            if (error) setError(null);
          }}
          onComplete={(entered) => void handleComplete(entered)}
          error={error}
        />

        {/* An escape from the second pass without dismissing the whole sheet. */}
        {first !== null ? (
          <Pressable
            onPress={() => {
              setFirst(null);
              setValue('');
              setError(null);
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
              Start over
            </T>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function ToggleRow({
  icon,
  color,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
      }}
    >
      <Glyph icon={icon} color={color} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong">{title}</T>
        <T variant="caption" tone="muted">
          {subtitle}
        </T>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceSunken, true: colors.accent }}
        thumbColor="#FFFFFF"
        accessibilityLabel={title}
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
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle: string;
  valueLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <ListRow
      leading={<Glyph icon={icon} color={color} />}
      title={title}
      titleColor={danger ? colors.danger : undefined}
      subtitle={subtitle}
      trailing={
        valueLabel ? (
          <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
            {valueLabel}
          </T>
        ) : undefined
      }
      chevron
      onPress={disabled ? () => {} : onPress}
      accessibilityLabel={`${title}${valueLabel ? `, ${valueLabel}` : ''}`}
    />
  );
}
