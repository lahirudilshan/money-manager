import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, View } from 'react-native';
import { Text } from '~/shared/components/ui';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { extensionOf, fileBadge, type FileKind } from '~/shared/lib/fileKinds';
import { readableOn, washFor } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { kindOfDoc } from '../logic/search';

/**
 * Each kind of file gets a hue from the category palette and an outline icon,
 * so a folder of mixed files is scannable before any title is read: red PDF,
 * blue Word, green sheet — the colours people already associate with them.
 */
export const KIND_VISUAL: Record<FileKind, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  image: { color: '#0284C7', icon: 'image-outline' },
  pdf: { color: '#DC2626', icon: 'document-text-outline' },
  doc: { color: '#2563EB', icon: 'document-outline' },
  sheet: { color: '#16A34A', icon: 'grid-outline' },
  slides: { color: '#EA580C', icon: 'easel-outline' },
  text: { color: '#475569', icon: 'reader-outline' },
  audio: { color: '#9333EA', icon: 'musical-notes-outline' },
  video: { color: '#C026D3', icon: 'film-outline' },
  archive: { color: '#57534E', icon: 'archive-outline' },
  other: { color: '#475569', icon: 'document-attach-outline' },
};

export interface ThumbFile {
  imageUri: string | null;
  fileName: string | null;
  title: string;
}

/** The path to draw for a file, if it is on this phone (or cached from Drive). */
export function resolveDocPath(file: Pick<ThumbFile, 'imageUri' | 'fileName'>): string | null {
  return resolveImageUri(file.imageUri, extensionOf(file.fileName) || undefined);
}

/**
 * A small preview of a file: the photo itself, or a tinted tile with the
 * kind's icon and extension. A file that lives only in Drive and has not been
 * fetched yet says so with a cloud, rather than looking empty.
 */
export function FileThumb({
  file,
  width,
  height,
}: {
  file: ThumbFile;
  width: number;
  height: number;
}) {
  const { colors, mode, radius } = useTheme();
  const kind = kindOfDoc(file);
  const path = resolveDocPath(file);
  const visual = KIND_VISUAL[kind];
  const wash = washFor(visual.color, mode);
  const ink = readableOn(visual.color, wash);
  const compact = width < 56;

  if (kind === 'image' && path) {
    return (
      <Image
        source={{ uri: path }}
        style={{ width, height, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius.sm,
        backgroundColor: wash,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <Ionicons
        name={!path && file.imageUri ? 'cloud-download-outline' : visual.icon}
        size={Math.round(Math.min(width, height) * (compact ? 0.42 : 0.34))}
        color={ink}
      />
      {height >= 56 ? (
        <Text variant="label" color={ink} numberOfLines={1} style={{ fontSize: compact ? 9 : 10 }}>
          {fileBadge(file.fileName ?? file.imageUri).toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}
