import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { STATUS_ORDER, type SubcategoryStatus } from '../core/planning';
import { statusStyle } from '../theme';
import { useTheme } from '../theme/ThemeProvider';
import { Label, T } from './ui';

const STATUS_LABEL: Record<SubcategoryStatus, string> = {
  pending: 'Not paid yet',
  paid: 'Paid',
};

/**
 * Pending/paid as two distinct buttons.
 *
 * The segmented pill that briefly replaced these read as a settings row rather
 * than a choice, and the unselected half looked disabled. Two separate buttons
 * make both options equally present; what keeps them from shouting is the
 * restraint — a row rather than stacked cards, a filled check on the chosen one,
 * an empty circle on the other, and the status colour used only on the
 * selection.
 *
 * Labels are written as the user would say them ("Not paid yet" rather than
 * "Pending"), since the bare status word means little out of context.
 */
export function StatusToggle({
  value,
  onChange,
  label = 'Status',
}: {
  value: SubcategoryStatus;
  onChange: (status: SubcategoryStatus) => void;
  label?: string;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label.toUpperCase()}</Label>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {STATUS_ORDER.map((key) => {
          const selected = value === key;
          const style = statusStyle(key, colors);
          return (
            <Pressable
              key={key}
              onPress={() => onChange(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={STATUS_LABEL[key]}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                paddingVertical: 13,
                borderRadius: radius.md,
                borderWidth: 1.5,
                borderColor: selected ? style.fg : colors.hairline,
                backgroundColor: selected ? style.bg : colors.surface,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              {/* Filled check when chosen, hollow ring when not — the state is
                  legible without relying on colour alone. */}
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={selected ? style.fg : colors.inkMuted}
              />
              <T
                variant="small"
                color={selected ? style.fg : colors.inkSecondary}
                style={{ fontWeight: selected ? '700' : '500' }}
              >
                {STATUS_LABEL[key]}
              </T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
