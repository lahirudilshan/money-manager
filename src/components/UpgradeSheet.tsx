import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { planFor, type Feature } from '../core/plans';
import { useAppStore } from '../store/useAppStore';
import { useTheme } from '../theme/ThemeProvider';
import { SMART_DETECT_NAME, SMART_DETECT_TAGLINE, SmartDetectBadge } from './SmartDetectBadge';
import { BottomSheet, Button, GradientButton, Row, T } from './ui';

/**
 * Shown when a locked feature is used on a plan that does not include it.
 *
 * Names the tier and what it costs rather than a vague "upgrade to continue" —
 * the point of the prompt is to answer "what do I get and what does it cost"
 * without making the user hunt for a plans screen first.
 *
 * There is no billing yet, so the primary action just sets the local plan. When
 * a store integration arrives, only `onUpgrade` changes.
 */
export function UpgradeSheet({
  visible,
  feature,
  onClose,
}: {
  visible: boolean;
  feature: Feature;
  onClose: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const setPlan = useAppStore((s) => s.setPlan);
  const required = planFor(feature);

  if (!required) return null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`${required.name} feature`}
      eyebrow="Locked"
      icon="sparkles"
      iconColor={colors.accent}
      scroll
      footer={
        <View style={{ gap: space.sm }}>
          <GradientButton
            label={`Get ${required.name}`}
            icon="sparkles"
            onPress={() => {
              setPlan(required.id);
              onClose();
            }}
          />
          <Button label="Not now" variant="secondary" onPress={onClose} />
        </View>
      }
    >
      <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.md }}>
        <SmartDetectBadge />
        <T variant="title" style={{ textAlign: 'center' }}>
          {SMART_DETECT_NAME}
        </T>
        <T variant="small" tone="muted" style={{ textAlign: 'center', maxWidth: 300 }}>
          {SMART_DETECT_TAGLINE}
        </T>
      </View>

      <View
        style={{
          gap: space.md,
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
        }}
      >
        <Row justify="space-between" align="center">
          <T variant="bodyStrong">{required.name}</T>
          <Row gap={4} align="baseline">
            <T variant="figureLarge" color={colors.accent}>
              {required.price}
            </T>
            <T variant="caption" tone="muted">
              {required.period}
            </T>
          </Row>
        </Row>

        {required.perks.map((perk) => (
          <Row key={perk.label} gap={space.sm} align="flex-start">
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <View style={{ flex: 1, gap: 1 }}>
              <T variant="small" style={{ fontWeight: '700' }}>
                {perk.label}
              </T>
              {perk.detail ? (
                <T variant="caption" tone="muted">
                  {perk.detail}
                </T>
              ) : null}
            </View>
          </Row>
        ))}

        {/* Says the upgrade is additive, without repeating the whole Free list
            in a prompt whose job is to explain one locked feature. */}
        <T variant="caption" tone="muted">
          Plus everything in Free.
        </T>
      </View>

      <T variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        Billing is not connected yet — this unlocks the feature on this device.
      </T>
    </BottomSheet>
  );
}
