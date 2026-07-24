import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet, Button, Divider, Glyph, Label, Row, ScreenHeader, Surface, T } from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { syncCategoryReminders, unavailableReason } from '../../src/services/notifications';
import { confirmWithBiometrics } from '../../src/services/biometrics';
import {
  selectBoardTotals,
  selectCategoryViews,
  useAppStore,
} from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const CONFIRM_WORD = 'DELETE';

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

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rateText, setRateText] = useState(String(state.usdRate));
  const [syncing, setSyncing] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencyQuery, setCurrencyQuery] = useState('');
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

  function beginClear() {
    Alert.alert(
      'Clear all data?',
      'This permanently deletes every card, category, subcategory, income, loan, and history on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: async () => {
            // Gate the destructive path behind Face ID / passcode before even
            // showing the type-to-confirm step.
            const ok = await confirmWithBiometrics('Confirm it is you to clear all data');
            if (ok) setConfirmOpen(true);
          },
        },
      ],
    );
  }

  function closeConfirm() {
    if (clearing) return;
    setConfirmOpen(false);
    setConfirmText('');
  }

  async function confirmClear() {
    setClearing(true);
    try {
      await resetAllData();
      setConfirmOpen(false);
      setConfirmText('');
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

        {/* Automation — the SMS → draft pipeline setup guide. */}
        <Section title="AUTOMATION">
          <SettingRow
            icon="chatbox-ellipses-outline"
            color={colors.accent}
            title="Auto-detect transactions"
            subtitle="Turn incoming bank SMS into drafts"
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
              placeholderTextColor={colors.inkFaint}
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
              placeholderTextColor={colors.inkFaint}
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
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.lg }}>
          <Surface style={{ gap: space.md }}>
            <Row gap={space.sm}>
              <Glyph icon="warning-outline" color={colors.danger} size={32} />
              <View style={{ flex: 1 }}>
                <T variant="heading">Last check</T>
                <T variant="caption" tone="muted">
                  Type {CONFIRM_WORD} to erase everything on this device.
                </T>
              </View>
            </Row>

            <TextInput
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!clearing}
              style={{
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                borderRadius: 10,
                paddingHorizontal: space.md,
                paddingVertical: 10,
                color: colors.ink,
                fontSize: 16,
              }}
            />

            <Row gap={space.sm}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={closeConfirm}
                disabled={clearing}
                style={{ flex: 1 }}
              />
              <Button
                label="Erase everything"
                variant="danger"
                icon="trash-outline"
                onPress={confirmClear}
                disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}
                loading={clearing}
                style={{ flex: 1 }}
              />
            </Row>
          </Surface>
        </View>
      </Modal>
    </>
  );
}


/** A titled group of setting rows in one surface. */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  const { space } = useTheme();
  return (
    <Surface style={{ gap: space.xs }} padded={false}>
      <View style={{ padding: space.lg, paddingBottom: note ? space.xs : space.md, gap: space.xs }}>
        <Label>{title}</Label>
        {note ? (
          <T variant="caption" tone="muted">
            {note}
          </T>
        ) : null}
      </View>
      <Divider />
      {children}
    </Surface>
  );
}

/** A setting row with a native on/off switch instead of a chevron. */
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
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}${valueLabel ? `, ${valueLabel}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      <Glyph icon={icon} color={color} />
      <View style={{ flex: 1 }}>
        <T variant="bodyStrong" color={danger ? colors.danger : colors.ink}>
          {title}
        </T>
        <T variant="caption" tone="muted">
          {subtitle}
        </T>
      </View>
      {valueLabel ? (
        <T variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
          {valueLabel}
        </T>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
    </Pressable>
  );
}
