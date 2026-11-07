import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useDriveGate } from '~/shared/components/DriveConnectSheet';
import { BottomSheet, Text } from '~/shared/components/ui';
import { pickFiles } from '~/shared/lib/attachmentPicker';
import { docFileRepo, docFolderRepo } from '~/db/repositories/documents';
import type { DocFile, DocFolder } from '~/db/schema';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** A file just chosen, still in the picker's cache — persisted on save. */
export interface PickedDoc {
  uri: string;
  name: string;
  mimeType: string;
  size: number | null;
}

export type DocSource = 'camera' | 'library' | 'files';

/**
 * Pick one file from the camera, the photo library or Files.
 *
 * Asks about Google Drive once, before the first attachment, exactly as every
 * other attach control does — so a passport photo is backed up from the start.
 */
export function useDocPicker() {
  const drive = useDriveGate();

  async function pick(source: DocSource): Promise<PickedDoc | null> {
    await drive.ensureDriveChoice();

    if (source === 'files') {
      const picked = await pickFiles({ multiple: false });
      if (!picked.ok) {
        if (picked.error) Alert.alert('Could not open Files', picked.error);
        return null;
      }
      const file = picked.files[0];
      return file ? { uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size } : null;
    }

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === 'camera' ? 'Camera is off for Dayly' : 'Photos are off for Dayly',
        'Turn it on in Settings → Dayly to add documents this way.',
      );
      return null;
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ['images'] });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return null;
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      uri: asset.uri,
      // The picker re-encodes as JPEG at this quality; the name says so.
      name: asset.fileName?.replace(/\.[a-z0-9]+$/i, '.jpg') ?? `Photo ${stamp}.jpg`,
      mimeType: 'image/jpeg',
      size: asset.fileSize ?? null,
    };
  }

  return { pick, driveSheet: drive.sheet };
}

const SOURCES: { key: DocSource; icon: keyof typeof Ionicons.glyphMap; title: string; hint: string }[] = [
  { key: 'camera', icon: 'camera-outline', title: 'Take a photo', hint: 'Snap a paper document now' },
  { key: 'library', icon: 'images-outline', title: 'Choose a photo', hint: 'From your photo library' },
  { key: 'files', icon: 'folder-open-outline', title: 'Browse files', hint: 'PDF, Word, Excel or any file' },
];

/** The three ways in, as big rows — one tap each, no second question. */
export function SourceChoices({ onChoose }: { onChoose: (source: DocSource) => void }) {
  const { colors, radius, space } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      {SOURCES.map((source) => (
        <Pressable
          key={source.key}
          onPress={() => onChoose(source.key)}
          accessibilityRole="button"
          accessibilityLabel={source.title}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            padding: space.md,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.hairline,
            backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
          })}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={source.icon} size={22} color={colors.accentInk} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{source.title}</Text>
            <Text variant="caption" tone="secondary">
              {source.hint}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
        </Pressable>
      ))}
    </View>
  );
}

/** "Add a document" — where from? Shown before the details form. */
export function AddSourceSheet({
  visible,
  onClose,
  onChoose,
  folderName,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (source: DocSource) => void;
  folderName?: string;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Add a document"
      eyebrow={folderName ? `Into ${folderName}` : undefined}
      icon="add"
      iconColor="#CA8A04"
    >
      <View style={{ padding: 16 }}>
        <SourceChoices onChoose={onChoose} />
      </View>
    </BottomSheet>
  );
}

/** Folders and files, re-read every time the screen comes into view. */
export function useDocsData() {
  const [data, setData] = useState<{ folders: DocFolder[]; files: DocFile[] }>({ folders: [], files: [] });

  const reload = useCallback(() => {
    try {
      setData({ folders: docFolderRepo.all(), files: docFileRepo.all() });
    } catch {
      // The tables are created at launch; a failed read shows as empty, not a crash.
      setData({ folders: [], files: [] });
    }
  }, []);

  useFocusEffect(reload);

  return { ...data, reload };
}
