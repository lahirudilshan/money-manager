import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Divider,
  Glyph,
  Row,
  ScreenHeader,
  Surface,
  T,
} from '../../src/components/ui';
import { useTabBarClearance } from '../../src/components/TabBar';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

const CONFIRM_WORD = 'DELETE';

/**
 * The one screen that isn't about the plan itself. Currently a single
 * destructive action — wiping the local database — so it stays a plain list
 * rather than borrowing the board's card layout.
 */
export default function SettingsScreen() {
  const { colors, space } = useTheme();
  const tabClearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const resetAllData = useAppStore((s) => s.resetAllData);
  const seedDemoData = useAppStore((s) => s.seedDemoData);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [seeding, setSeeding] = useState(false);

  function handleSeedDemo() {
    Alert.alert(
      'Load demo data?',
      'This adds the sample cards, groups, income and loans on top of whatever is already here.',
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
      'This permanently deletes every card, group, category, income, loan, and history on this device. This cannot be undone.',
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
      Alert.alert(
        'Could not clear data',
        error instanceof Error ? error.message : String(error),
      );
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

        {__DEV__ ? (
          <Surface style={{ gap: space.xs }} padded={false}>
            <View style={{ padding: space.lg, gap: space.xs }}>
              <T variant="label" tone="muted">DEVELOPER</T>
              <T variant="small" tone="muted">
                Only visible in dev builds.
              </T>
            </View>
            <Divider />
            <Pressable
              onPress={handleSeedDemo}
              disabled={seeding}
              accessibilityRole="button"
              accessibilityLabel="Seed demo data"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.lg,
                opacity: pressed || seeding ? 0.7 : 1,
              })}
            >
              <Glyph icon="flask-outline" color={colors.accent} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">Seed demo data</T>
                <T variant="caption" tone="muted">
                  Loads the sample plan used for development
                </T>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
            </Pressable>
          </Surface>
        ) : null}

        <Surface style={{ gap: space.xs }} padded={false}>
          <View style={{ padding: space.lg, gap: space.xs }}>
            <T variant="label" tone="muted">DANGER ZONE</T>
            <T variant="small" tone="muted">
              Everything below acts on the data stored on this device only.
              There is no cloud backup, so a clear cannot be recovered.
            </T>
          </View>
          <Divider />
          <Pressable
            onPress={beginClear}
            accessibilityRole="button"
            accessibilityLabel="Clear all data"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.lg,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Glyph icon="trash-outline" color={colors.danger} />
            <View style={{ flex: 1 }}>
              <T variant="bodyStrong" color={colors.danger}>
                Clear all data
              </T>
              <T variant="caption" tone="muted">
                Deletes cards, groups, categories, income, loans and status history
              </T>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </Pressable>
        </Surface>

        <View style={{ alignItems: 'center', paddingTop: space.md }}>
          <T variant="caption" tone="muted">
            {Constants.expoConfig?.name ?? 'Money Manager'}
            {Constants.expoConfig?.version ? ` · v${Constants.expoConfig.version}` : ''}
          </T>
        </View>
      </ScrollView>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'center',
            padding: space.lg,
          }}
        >
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
