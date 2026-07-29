import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { deletePersistedImage, persistPickedImage } from '../core/imageStorage';
import { useTheme } from '../theme/ThemeProvider';
import { Label, T } from './ui';

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
              icon="camera-outline"
              label="Retake"
              busy={busy}
              compact
              onPress={() => pick('camera')}
            />
            <SlotButton
              icon="image-outline"
              label="Change"
              busy={busy}
              compact
              onPress={() => pick('library')}
            />
            <SlotButton icon="trash-outline" label="Remove" compact tone="danger" onPress={remove} />
          </View>
        </View>
      ) : (
        // Two dashed squares side by side: camera and library, no intermediate
        // "where from?" step.
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <SlotButton
            icon="camera-outline"
            label="Take photo"
            busy={busy}
            size={size}
            onPress={() => pick('camera')}
          />
          <SlotButton
            icon="cloud-upload-outline"
            label="Upload"
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
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy?: boolean;
  onPress: () => void;
  size?: number;
  compact?: boolean;
  tone?: 'danger';
}) {
  const { colors, radius, space } = useTheme();
  const color = tone === 'danger' ? colors.danger : colors.inkSecondary;

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
          borderRadius: radius.sm,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.hairlineStrong,
          backgroundColor: pressed ? colors.hairline : colors.surfaceSunken,
          opacity: busy ? 0.5 : 1,
        })}
      >
        <Ionicons name={icon} size={15} color={color} />
        <T variant="caption" color={color} style={{ fontWeight: '600' }}>
          {label}
        </T>
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
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: pressed ? colors.accent : colors.hairlineStrong,
        backgroundColor: pressed ? colors.hairline : colors.surfaceSunken,
        opacity: busy ? 0.6 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <Ionicons name={icon} size={22} color={colors.inkMuted} />
          <T variant="caption" tone="muted" style={{ fontWeight: '600' }}>
            {label}
          </T>
        </>
      )}
    </Pressable>
  );
}
