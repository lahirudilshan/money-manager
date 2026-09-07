import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Divider, Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { Screen } from '~/shared/components/Screen';
import { tankWindows, type FuelFill } from '~/features/fuel/logic/fuel';
import { formatMoney } from '~/shared/lib/money';
import { fuelEntryRepo } from '../../../src/db/repositories';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Every fill-up for one vehicle, newest first, each one tappable to correct.
 *
 * ## Why the order flips
 *
 * `fuelEntryRepo.byVehicle` returns fills in ODOMETER order, because that is the
 * order consumption is measured in (see core/fuel.ts). A person reading their
 * history wants the opposite — the last tank first — so this reverses for
 * display only. The maths keeps its own order and is unaffected.
 *
 * ## Why each row carries a km/L
 *
 * The number is what makes a row worth checking: a tank reading 6 km/L next to
 * a column of 14s is how a mistyped odometer announces itself, and that is the
 * whole reason to open this list. It comes from `tankWindows`, keyed by the fill
 * that CLOSED the window — so the rows showing a dash are not broken, they are
 * the part-fills and chain-breaks that cannot close one.
 */
export default function FuelHistoryScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const state = useAppStore();
  const { vehicle: vehicleId } = useLocalSearchParams<{ vehicle?: string }>();

  const vehicle = useMemo(
    () => state.vehicles.find((v) => v.id === vehicleId) ?? state.vehicles[0],
    [state.vehicles, vehicleId],
  );

  // Read straight from the repository, like the rest of the mini-app — fill-ups
  // are not in the global store. `state.vehicles` re-runs this after a write.
  const fills = useMemo(
    () => (vehicle ? fuelEntryRepo.byVehicle(vehicle.id) : []),
    [vehicle, state.vehicles],
  );

  /** Measured efficiency per closing fill, so a row can show its own figure. */
  const efficiencyById = useMemo(() => {
    const windows = tankWindows(
      fills.map(
        (row): FuelFill => ({
          id: row.id,
          odometer: row.odometer,
          litres: row.litres,
          isFullTank: row.isFullTank,
          missedPrevious: row.missedPrevious,
          filledAt: row.filledAt,
          totalMinor: row.totalMinor,
        }),
      ),
    );
    return new Map(windows.map((w) => [w.id, w]));
  }, [fills]);

  const unit = vehicle?.odometerUnit ?? 'km';
  const newestFirst = useMemo(() => [...fills].reverse(), [fills]);

  return (
    <Screen
      title="Fill-up history"
      onBack={() => router.back()}
      footer={
        vehicle ? (
          <GradientButton
            label="Log a fill-up"
            icon="add"
            onPress={() => router.push(`/mini/fuel/entry?vehicle=${vehicle.id}`)}
          />
        ) : undefined
      }
    >
      {newestFirst.length === 0 ? (
        <Empty
          icon="water-outline"
          title="No fill-ups yet"
          message="Log one at the pump and the mileage starts measuring itself from the second full tank."
        />
      ) : (
        <View style={{ gap: space.sm }}>
          <Label>{newestFirst.length} FILL-UPS</Label>
          <Surface padded={false}>
            {newestFirst.map((row, index) => {
              const window = efficiencyById.get(row.id);
              return (
                <View key={row.id}>
                  {index > 0 ? <Divider style={{ marginHorizontal: space.lg }} /> : null}
                  <Pressable
                    onPress={() => router.push(`/mini/fuel/entry?id=${row.id}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit fill-up, ${row.litres} litres at ${row.odometer} ${unit}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                    })}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Row gap={6} align="center">
                        <Text variant="small" style={{ fontWeight: '600' }} numberOfLines={1}>
                          {row.litres.toFixed(2)} L
                        </Text>
                        {/* A part-fill is why a row has no figure, so it says so
                            rather than leaving an unexplained dash. */}
                        {row.isFullTank ? null : (
                          <Text variant="caption" tone="muted">
                            part-fill
                          </Text>
                        )}
                        {row.missedPrevious ? (
                          <Ionicons name="unlink-outline" size={12} color={colors.inkMuted} />
                        ) : null}
                        {row.imageUri ? (
                          <Ionicons name="camera-outline" size={12} color={colors.inkMuted} />
                        ) : null}
                      </Row>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {new Date(row.filledAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })}
                        {' · '}
                        {row.odometer.toLocaleString()} {unit}
                        {row.station ? ` · ${row.station}` : ''}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="figure">
                        {row.totalMinor != null ? formatMoney(row.totalMinor) : '—'}
                      </Text>
                      <Text
                        variant="caption"
                        color={window ? colors.completed : colors.inkMuted}
                      >
                        {window ? `${window.efficiency.toFixed(1)} ${unit}/L` : '—'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={colors.inkMuted} />
                  </Pressable>
                </View>
              );
            })}
          </Surface>
        </View>
      )}
    </Screen>
  );
}
