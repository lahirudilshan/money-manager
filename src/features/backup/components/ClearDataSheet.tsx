import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { BottomSheet, Button, Label, Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { confirmWithBiometrics } from '~/shared/lib/biometrics';
import { tableRowCounts } from '~/db/client';
import { useAppStore } from '~/store/useAppStore';
import {
  ALL_TABLES,
  RECORDS_ERASE,
  RECORDS_KEEP,
  RESET_AREAS,
  rowsToClear,
  tablesToClear,
  type ResetAreaKey,
  type ResetMode,
} from '../logic/resetPlan';

const MODES: {
  key: ResetMode;
  title: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    key: 'records',
    title: 'Erase records, keep my setup',
    hint: 'Start fresh with the same accounts, categories, people and items',
    icon: 'refresh-outline',
  },
  {
    key: 'areas',
    title: 'Erase only what I choose',
    hint: 'Pick areas — health, buddy loans, history…',
    icon: 'checkbox-outline',
  },
  {
    key: 'everything',
    title: 'Erase everything',
    hint: 'Every record and setting. You start again from setup',
    icon: 'nuclear-outline',
  },
];

/**
 * "Clear data" — three ways, from gentlest to total.
 *
 * Each choice says, before anything happens, what goes and what stays, with a
 * count. The erase itself sits behind Face ID / passcode, the same gate the
 * old single "Erase everything" alert had.
 */
export function ClearDataSheet({
  visible,
  onClose,
  onBackupFirst,
}: {
  visible: boolean;
  onClose: () => void;
  onBackupFirst: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const clearData = useAppStore((s) => s.clearData);

  const [mode, setMode] = useState<ResetMode>('records');
  const [areas, setAreas] = useState<ResetAreaKey[]>([]);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Counted fresh each time the sheet opens, so the numbers match the board.
  useEffect(() => {
    if (!visible) return;
    setMode('records');
    setAreas([]);
    setCounts(tableRowCounts(ALL_TABLES));
  }, [visible]);

  const tables = useMemo(() => tablesToClear(mode, areas), [mode, areas]);
  const rows = rowsToClear(tables, counts);
  const nothing = tables.length === 0;

  function toggle(key: ResetAreaKey) {
    setAreas((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  }

  const chosenLabels = RESET_AREAS.filter((a) => areas.includes(a.key)).map((a) => a.label);

  function confirm() {
    if (busy || nothing) return;
    const what =
      mode === 'everything'
        ? 'This deletes every account, category, record and setting on this phone. You will start again from setup.'
        : mode === 'records'
          ? `This deletes ${RECORDS_ERASE.toLowerCase()}. Your setup stays.`
          : `This deletes: ${chosenLabels.join(', ')}.`;

    Alert.alert(
      mode === 'everything' ? 'Erase everything?' : 'Erase this data?',
      `${what}\n\nIt cannot be undone unless you have a backup.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Erase',
          style: 'destructive',
          onPress: async () => {
            const ok = await confirmWithBiometrics('Confirm it is you to erase data');
            if (!ok) return;
            setBusy(true);
            try {
              await clearData(mode, areas);
              onClose();
              if (mode !== 'everything') Alert.alert('Done', 'The data you chose has been erased.');
            } catch (error) {
              Alert.alert(
                'Could not erase',
                error instanceof Error ? error.message : String(error),
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  const buttonLabel = nothing
    ? 'Choose what to erase'
    : mode === 'everything'
      ? 'Erase everything'
      : rows > 0
        ? `Erase ${rows.toLocaleString()} record${rows === 1 ? '' : 's'}`
        : 'Erase';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scroll
      icon="trash-outline"
      iconColor={colors.danger}
      eyebrow="This phone only"
      title="Clear data"
      footer={
        <Button
          label={buttonLabel}
          icon="trash-outline"
          variant="danger"
          disabled={nothing}
          loading={busy}
          onPress={confirm}
        />
      }
    >
      {/* The three ways, as a radio list. */}
      <View style={{ gap: space.sm }}>
        {MODES.map((option) => {
          const selected = option.key === mode;
          const danger = option.key === 'everything';
          const tint = danger ? colors.danger : colors.accent;
          return (
            <Pressable
              key={option.key}
              onPress={() => setMode(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.md,
                borderRadius: radius.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? tint : colors.hairline,
                backgroundColor: selected
                  ? danger
                    ? colors.dangerSoft
                    : colors.accentSoft
                  : colors.surface,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: danger ? colors.dangerSoft : colors.accentSoft,
                }}
              >
                <Ionicons name={option.icon} size={18} color={tint} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{option.title}</Text>
                <Text variant="caption" tone="secondary">
                  {option.hint}
                </Text>
              </View>
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? tint : colors.inkMuted}
              />
            </Pressable>
          );
        })}
      </View>

      {/* What the chosen way does. */}
      {mode === 'records' ? (
        <View style={{ gap: space.sm }}>
          <Explain icon="checkmark-circle" color={colors.positive} title="Kept" body={RECORDS_KEEP} />
          <Explain icon="close-circle" color={colors.danger} title="Erased" body={RECORDS_ERASE} />
        </View>
      ) : null}

      {mode === 'everything' ? (
        <Explain
          icon="warning"
          color={colors.danger}
          title="Nothing is kept"
          body="Accounts, categories, health records, buddy loans, vehicles, tracked items, messages and settings — all of it. The app restarts at setup."
        />
      ) : null}

      {mode === 'areas' ? (
        <View style={{ gap: space.sm }}>
          <Label>TICK WHAT TO ERASE</Label>
          <View
            style={{
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.hairline,
              overflow: 'hidden',
              backgroundColor: colors.surface,
            }}
          >
            {RESET_AREAS.map((area, index) => {
              const ticked = areas.includes(area.key);
              const n = rowsToClear(area.tables, counts);
              return (
                <Pressable
                  key={area.key}
                  onPress={() => toggle(area.key)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: ticked }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    padding: space.md,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.hairline,
                    backgroundColor: pressed
                      ? colors.surfaceSunken
                      : ticked
                        ? colors.dangerSoft
                        : 'transparent',
                  })}
                >
                  <Ionicons
                    name={area.icon}
                    size={18}
                    color={ticked ? colors.danger : colors.inkSecondary}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Row style={{ gap: space.xs, alignItems: 'center' }}>
                      <Text variant="bodyStrong">{area.label}</Text>
                      <Text variant="caption" tone="muted">
                        {n === 0 ? 'empty' : `${n.toLocaleString()}`}
                      </Text>
                    </Row>
                    <Text variant="caption" tone="secondary">
                      {ticked && area.alsoErases ? area.alsoErases : area.hint}
                    </Text>
                  </View>
                  <Ionicons
                    name={ticked ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={ticked ? colors.danger : colors.inkMuted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Back up first — the one undo there is. */}
      <Pressable
        onPress={onBackupFirst}
        accessibilityRole="button"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceSunken,
        }}
      >
        <Ionicons name="cloud-upload-outline" size={18} color={colors.accent} />
        <Text variant="small" style={{ flex: 1 }}>
          Erasing cannot be undone. Take a backup first if you might want this back.
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
      </Pressable>
    </BottomSheet>
  );
}

function Explain({
  icon,
  color,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  body: string;
}) {
  const { space } = useTheme();
  return (
    <Row style={{ gap: space.sm, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="small" tone="secondary">
          {body}
        </Text>
      </View>
    </Row>
  );
}
