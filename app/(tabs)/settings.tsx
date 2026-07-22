import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Divider, Glyph, Label, Row, ScreenHeader, Surface, T } from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { syncCategoryReminders, unavailableReason } from '../../src/services/notifications';
import {
  selectBoardTotals,
  selectCategoryViews,
  useAppStore,
} from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const CONFIRM_WORD = 'DELETE';
const CURRENCIES = ['LKR', 'USD', 'EUR', 'GBP', 'INR', 'AUD'];

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
        { text: 'Continue', style: 'destructive', onPress: () => setConfirmOpen(true) },
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

  function cycleCurrency() {
    const index = CURRENCIES.indexOf(state.currency);
    state.setCurrency(CURRENCIES[(index + 1) % CURRENCIES.length]);
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

        {/* Preferences. */}
        <Section title="PREFERENCES">
          <SettingRow
            icon="cash-outline"
            color={colors.accent}
            title="Currency"
            subtitle="Symbol shown on every amount"
            valueLabel={state.currency}
            onPress={cycleCurrency}
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
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Row gap={space.md}>
              <Glyph icon="contrast-outline" color={colors.accent} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">Theme</T>
                <T variant="caption" tone="muted">
                  Light, dark, or follow the device
                </T>
              </View>
            </Row>
            <Segmented
              options={[
                { key: 'system', label: 'System' },
                { key: 'light', label: 'Light' },
                { key: 'dark', label: 'Dark' },
              ]}
              selectedKey={state.themeMode}
              onSelect={(key) => state.setThemeMode(key as 'system' | 'light' | 'dark')}
            />
          </View>
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

      {/* USD rate editor. */}
      <Modal visible={rateOpen} transparent animationType="fade" onRequestClose={() => setRateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: space.lg }}>
          <Surface style={{ gap: space.md }}>
            <T variant="heading">USD exchange rate</T>
            <T variant="caption" tone="muted">
              How many {state.currency} one US dollar is worth. Used to convert foreign-currency
              income.
            </T>
            <TextInput
              value={rateText}
              onChangeText={setRateText}
              keyboardType="decimal-pad"
              autoFocus
              placeholder="300"
              placeholderTextColor={colors.inkMuted}
              style={{
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                borderRadius: 10,
                paddingHorizontal: space.md,
                paddingVertical: 12,
                color: colors.ink,
                fontSize: 18,
                fontWeight: '700',
              }}
            />
            <Row gap={space.sm}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setRateOpen(false)}
                style={{ flex: 1 }}
              />
              <Button label="Save" onPress={handleSaveRate} style={{ flex: 1 }} />
            </Row>
          </Surface>
        </View>
      </Modal>

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
              placeholderTextColor={colors.inkMuted}
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

/** A segmented control — the row of mutually-exclusive pills used for theme. */
function Segmented({
  options,
  selectedKey,
  onSelect,
}: {
  options: { key: string; label: string }[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceSunken,
        borderRadius: radius.md,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((option) => {
        const selected = selectedKey === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => onSelect(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingVertical: 9,
              borderRadius: radius.sm,
              backgroundColor: selected ? colors.surface : 'transparent',
              opacity: pressed ? 0.8 : 1,
              ...(selected ? { borderWidth: 1, borderColor: colors.hairline } : {}),
            })}
          >
            <T
              variant="small"
              color={selected ? colors.ink : colors.inkSecondary}
              style={{ fontWeight: selected ? '700' : '500' }}
            >
              {option.label}
            </T>
          </Pressable>
        );
      })}
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
