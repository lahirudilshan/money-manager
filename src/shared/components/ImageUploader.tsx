import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { deletePersistedImage, persistPickedImage } from '~/shared/lib/imageStorage';
import { useTheme } from '../theme/ThemeProvider';
import { Glyph, Label, Text } from './ui';

/**
 * The one receipt/photo attachment control, used everywhere a slip can be
 * added — the transaction sheet, the bill editor, and anything later.
 *
 * Both ways in are offered directly as two dashed tiles: taking a photo and
 * choosing an existing one are equally likely, so asking "where from?" in a
 * modal first added a tap and a screen for no information gain. Dashed borders
 * and square shapes mark them as empty slots rather than primary actions.
 */
export function ImageUploader({
  label = 'Photo',
  value,
  onChange,
  /** Delete the old file when a new one replaces it. Off when the previous
   *  value is a saved record the caller may still need on cancel. */
  deleteOnReplace = true,
  size = 104,
  /** Show the attachment full-screen. Screens with a dedicated viewer pass it
   *  so a receipt can be read at full size. */
  onViewFullScreen,
}: {
  label?: string;
  value: string | null;
  onChange: (uri: string | null) => void;
  deleteOnReplace?: boolean;
  size?: number;
  onViewFullScreen?: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const [busy, setBusy] = React.useState(false);

  async function pick(source: 'camera' | 'library') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (result.canceled || !result.assets[0]) return;

    setBusy(true);
    try {
      const stored = await persistPickedImage(result.assets[0].uri);
      // Replacing leaves the old file orphaned on disk unless it is cleaned up.
      if (value && deleteOnReplace) deletePersistedImage(value);
      onChange(stored);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (value && deleteOnReplace) deletePersistedImage(value);
    onChange(null);
  }

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label.toUpperCase()}</Label>

      {value ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
          <Pressable
            onPress={onViewFullScreen}
            disabled={!onViewFullScreen}
            accessibilityRole="imagebutton"
            accessibilityLabel="View attached photo"
            style={({ pressed }) => ({ opacity: pressed && onViewFullScreen ? 0.8 : 1 })}
          >
            <Image
              source={{ uri: value }}
              style={{ width: size, height: size, borderRadius: radius.md }}
            />
          </Pressable>

          <View style={{ flex: 1, gap: space.sm }}>
            <SlotButton
              icon="camera"
              label="Retake"
              accent={colors.accent}
              busy={busy}
              compact
              onPress={() => pick('camera')}
            />
            <SlotButton
              icon="images"
              label="Choose"
              accent={colors.completed}
              busy={busy}
              compact
              onPress={() => pick('library')}
            />
            <SlotButton icon="trash-outline" label="Remove" compact tone="danger" onPress={remove} />
          </View>
        </View>
      ) : (
        /*
          Two dashed squares side by side: camera and library, no intermediate
          "where from?" step.

          Each carries its own TINTED ICON TILE rather than a bare grey glyph.
          The two slots were otherwise identical — same box, same border, same
          muted icon — so telling "take a photo now" from "pick one you already
          have" meant reading the caption every time. A filled tile in its own
          colour is recognised before the words are, and the same pair appears
          on every screen that attaches an image, so the shapes become familiar.
        */
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <SlotButton
            icon="camera"
            label="Take photo"
            accent={colors.accent}
            busy={busy}
            size={size}
            onPress={() => pick('camera')}
          />
          <SlotButton
            icon="images"
            label="Choose"
            accent={colors.completed}
            busy={busy}
            size={size}
            onPress={() => pick('library')}
          />
        </View>
      )}
    </View>
  );
}

/**
 * A dashed slot. Square and large when empty (the two entry points), compact
 * and inline once a photo exists (the manage actions beside the preview).
 */
function SlotButton({
  icon,
  label,
  busy,
  onPress,
  size,
  compact,
  tone,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy?: boolean;
  onPress: () => void;
  size?: number;
  compact?: boolean;
  tone?: 'danger';
  /**
   * Draw the glyph on a filled tile in this colour, rather than bare.
   *
   * What separates the camera slot from the library one. Omitted by the
   * Remove action, which should stay quiet rather than compete with the two
   * that actually attach something.
   */
  accent?: string;
}) {
  const { colors, radius, space } = useTheme();
  const color = tone === 'danger' ? colors.danger : colors.inkSecondary;

  /*
   * The glyph, on the app's own tinted tile when an accent is given.
   *
   * Uses the shared `Glyph` rather than a hand-rolled `View`. A saturated
   * filled tile was tried first and read as two bright buttons sitting inside a
   * quiet dashed slot — louder than the thing they attach to. `Glyph`'s default
   * is a SOFT tint with a coloured icon, which is what every other tile in the
   * app uses, so these now belong to the same family as the row icons on the
   * dashboard and in settings.
   */
  const glyph = (tileSize: number) =>
    accent ? (
      <Glyph icon={icon} color={accent} size={tileSize} />
    ) : (
      <Ionicons name={icon} size={tileSize * 0.48} color={color} />
    );

  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 9,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          borderWidth: 1,
          borderStyle: 'dashed',
          /*
           * Tinted the same way as the large slots above, so the actions beside
           * an attached photo belong to the same family as the ones that
           * attached it. The Remove action passes no accent and stays neutral —
           * it is the one button here that should not invite a tap.
           */
          borderColor: accent ? `${accent}${pressed ? 'AA' : '55'}` : colors.hairlineStrong,
          backgroundColor: accent
            ? `${accent}${pressed ? '22' : '0D'}`
            : pressed
              ? colors.hairline
              : colors.surfaceSunken,
          opacity: busy ? 0.5 : 1,
        })}
      >
        {glyph(24)}
        <Text variant="caption" color={accent ?? color} style={{ fontWeight: '700' }}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        /*
         * The dashes carry the slot's OWN colour, at low opacity.
         *
         * A neutral grey outline around a tinted tile left the two halves of
         * one control looking unrelated — the tile said "camera", the box said
         * nothing. Tinting the border makes the whole slot read as a single
         * blue or green thing, which is what makes the pair recognisable at a
         * glance rather than only after finding the icon.
         *
         * Kept at `55`/`14` hex alpha rather than full strength: a solid
         * coloured dash would compete with the tile and turn an empty slot into
         * the loudest thing on the form. It reads as tinted, not as filled.
         */
        borderColor: accent ? `${accent}${pressed ? 'AA' : '55'}` : colors.hairline,
        backgroundColor: accent ? `${accent}${pressed ? '22' : '0D'}` : colors.surface,
        opacity: busy ? 0.6 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          {glyph(42)}
          {/* The caption takes the slot's colour too, so tile, dashes and words
              are one thing rather than three. */}
          <Text
            variant="caption"
            tone={accent ? undefined : 'muted'}
            color={accent}
            style={{ fontWeight: '700' }}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
