import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Pressable,
  View,
} from 'react-native';
import { Label, Row, Surface, Text } from '~/shared/components/ui';
import { ImageUploader, useAttachmentPicking } from '~/shared/components/ImageUploader';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { isPdfAttachment } from '~/shared/lib/imageRef';
import { openAttachment } from '~/shared/lib/attachmentPicker';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { aiFillBlocked } from '~/features/ai/services/aiFill';

export type ReadOutcome = { ok: true; note?: string } | { ok: false; error: string };

/**
 * "Snap it and the form fills itself" — the same card wherever AI reads a
 * photo into a form.
 *
 * Title and hint across the top, the usual photo slots (Take photo · Choose ·
 * PDF) at full width beneath, then the reading status. A new photo is read as
 * soon as it lands — "Take photo" IS the scan button. When AI is off the card
 * is just the attachment, with one line saying the form works by hand.
 */
export function AiScanCard({
  label,
  title,
  hint,
  value,
  onChange,
  onRead,
  hasData,
  deleteOnReplace = true,
}: {
  label: string;
  /** "Scan the bill" */
  title: string;
  /** What AI will fill in. */
  hint: string;
  value: string | null;
  onChange: (uri: string | null) => void;
  /** Read the photo into the form. */
  onRead: (uri: string) => Promise<ReadOutcome>;
  /** The form already has data a re-read would overwrite — asks first. */
  hasData: boolean;
  deleteOnReplace?: boolean;
}) {
  const { colors, space } = useTheme();
  const blocked = aiFillBlocked();
  const [reading, setReading] = useState(false);
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null);
  const token = useRef(0);

  async function read(uri: string) {
    const mine = (token.current += 1);
    setReading(true);
    setOutcome(null);
    const result = await onRead(uri);
    if (mine !== token.current) return;
    setReading(false);
    setOutcome(result);
  }

  function readMaybe(uri: string, ask: boolean) {
    if (blocked) return;
    if (!ask) {
      void read(uri);
      return;
    }
    Alert.alert('Fill in from this photo?', 'What is typed below will be replaced with what AI reads.', [
      { text: 'Keep mine', style: 'cancel' },
      { text: 'Fill in', onPress: () => void read(uri) },
    ]);
  }

  function attached(uri: string | null) {
    onChange(uri);
    setOutcome(null);
    if (uri) readMaybe(uri, hasData);
  }

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <Surface style={{ gap: space.md }}>
        <View style={{ gap: 4 }}>
          <Row align="center" style={{ gap: 6 }}>
            {blocked ? (
              <Ionicons name="camera-outline" size={16} color={colors.inkSecondary} />
            ) : (
              <Ionicons name="sparkles" size={15} color={colors.accent} />
            )}
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {title}
            </Text>
          </Row>
          <Text variant="caption" tone="secondary">
            {blocked ? `${blocked} Or just type it in below.` : hint}
          </Text>
        </View>

        {value ? (
          <Captured
            value={value}
            reading={reading}
            outcome={outcome}
            canRead={!blocked}
            onReadAgain={() => readMaybe(value, hasData)}
            onChange={attached}
            deleteOnReplace={deleteOnReplace}
          />
        ) : (
          <ImageUploader
            label={label}
            hideLabel
            value={value}
            onChange={attached}
            deleteOnReplace={deleteOnReplace}
          />
        )}
      </Surface>
    </View>
  );
}

/**
 * The photo once it is taken: shown large, so it can be checked at a glance
 * (is the odometer in frame? is the bill flat?), with the reading state ON the
 * photo — a sweeping line while AI reads it, then a tick or a cross — and one
 * row of actions beneath.
 */
function Captured({
  value,
  reading,
  outcome,
  canRead,
  onReadAgain,
  onChange,
  deleteOnReplace,
}: {
  value: string;
  reading: boolean;
  outcome: ReadOutcome | null;
  canRead: boolean;
  onReadAgain: () => void;
  onChange: (uri: string | null) => void;
  deleteOnReplace: boolean;
}) {
  const { colors, space, radius } = useTheme();
  const { busy, pick, pickPdf, remove, driveSheet } = useAttachmentPicking({
    value,
    onChange,
    deleteOnReplace,
  });
  const resolved = resolveImageUri(value);
  const isPdf = isPdfAttachment(resolved ?? value);
  const height = 190;

  // A line sweeping down the photo while it is read — still under Reduce Motion.
  const sweep = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);
  useEffect(() => {
    if (!reading || reduceMotion) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1_400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1_400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reading, reduceMotion, sweep]);

  const status = reading
    ? { icon: null, text: 'Reading…', color: colors.accent }
    : outcome?.ok
      ? { icon: 'checkmark-circle' as const, text: 'Filled in', color: colors.completed }
      : outcome
        ? { icon: 'alert-circle' as const, text: 'Could not read', color: colors.danger }
        : null;

  return (
    <View style={{ gap: space.md }}>
      {driveSheet}
      <Pressable
        onPress={() => resolved && void openAttachment(resolved)}
        disabled={!resolved || reading}
        accessibilityRole="imagebutton"
        accessibilityLabel={isPdf ? 'Open the attached PDF' : 'View the photo full size'}
        style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
      >
        <View
          style={{
            height,
            borderRadius: radius.lg,
            overflow: 'hidden',
            backgroundColor: colors.surfaceSunken,
            borderWidth: 1,
            borderColor: status ? `${status.color}66` : colors.hairline,
          }}
        >
          {isPdf ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs }}>
              <Ionicons name="document-text" size={40} color={colors.danger} />
              <Text variant="small" tone="secondary">
                PDF attached · tap to open
              </Text>
            </View>
          ) : (
            <Image source={{ uri: resolved ?? undefined }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          )}

          {reading ? (
            <>
              <View
                pointerEvents="none"
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: `${colors.accent}14` }}
              />
              {reduceMotion ? null : (
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: 2,
                    backgroundColor: colors.accent,
                    shadowColor: colors.accent,
                    shadowOpacity: 0.9,
                    shadowRadius: 8,
                    transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [8, height - 10] }) }],
                  }}
                />
              )}
            </>
          ) : null}

          {status ? (
            <View
              style={{
                position: 'absolute',
                left: space.sm,
                bottom: space.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: space.md,
                paddingVertical: 6,
                borderRadius: radius.pill,
                backgroundColor: `${colors.surface}F0`,
              }}
            >
              {status.icon ? (
                <Ionicons name={status.icon} size={15} color={status.color} />
              ) : (
                <ActivityIndicator size="small" color={status.color} />
              )}
              <Text variant="caption" color={status.color} style={{ fontWeight: '700' }}>
                {status.text}
              </Text>
            </View>
          ) : null}

          {!isPdf && !reading ? (
            <View
              style={{
                position: 'absolute',
                right: space.sm,
                bottom: space.sm,
                width: 30,
                height: 30,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${colors.surface}F0`,
              }}
            >
              <Ionicons name="expand-outline" size={15} color={colors.inkSecondary} />
            </View>
          ) : null}
        </View>
      </Pressable>

      {outcome && !reading ? (
        <Text variant="small" tone={outcome.ok ? 'secondary' : undefined}>
          {outcome.ok
            ? `${outcome.note ? `${outcome.note} ` : ''}AI can misread — check the fields below before saving.`
            : outcome.error}
        </Text>
      ) : null}

      <Row gap={space.sm}>
        <Action icon="camera-outline" label="Retake" onPress={() => void pick('camera')} disabled={busy || reading} />
        <Action icon="images-outline" label="Choose" onPress={() => void pick('library')} disabled={busy || reading} />
        {canRead ? (
          <Action icon="sparkles-outline" label="Read again" onPress={onReadAgain} disabled={reading} accent />
        ) : (
          <Action icon="document-text-outline" label="PDF" onPress={() => void pickPdf()} disabled={busy} />
        )}
        <Action icon="trash-outline" label="Remove" onPress={remove} disabled={reading} danger />
      </Row>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled,
  accent,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
  danger?: boolean;
}) {
  const { colors, radius } = useTheme();
  const color = danger ? colors.danger : accent ? colors.accent : colors.inkSecondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 3,
        paddingVertical: 8,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.hairline : accent ? colors.accentSoft : colors.surfaceSunken,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={icon} size={18} color={color} />
      <Text variant="caption" color={color} style={{ fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
