import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '~/shared/components/ui';
import type { DocFile, DocFolder } from '~/db/schema';
import { FILE_KIND_LABEL, formatBytes } from '~/shared/lib/fileKinds';
import { readableOn, washFor } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { kindOfDoc } from '../logic/search';
import { FileThumb } from './FileThumb';

/** The default folder hue when none was picked: the add-on's own amber. */
export const FOLDER_DEFAULT_COLOR = '#CA8A04';

/** One tag. `onPress` filters by it; `onRemove` shows an ×; `suggested` shows a +. */
export function TagChip({
  tag,
  onPress,
  onRemove,
  suggested = false,
  selected = false,
}: {
  tag: string;
  onPress?: () => void;
  onRemove?: () => void;
  suggested?: boolean;
  selected?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const background = selected ? colors.accent : suggested ? 'transparent' : colors.accentSoft;
  const ink = selected ? colors.inkInverse : colors.accentInk;

  return (
    <Pressable
      onPress={onPress ?? onRemove}
      disabled={!onPress && !onRemove}
      accessibilityRole="button"
      accessibilityLabel={onRemove ? `Remove tag ${tag}` : suggested ? `Add tag ${tag}` : `Tag ${tag}`}
      hitSlop={4}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: space.sm + 2,
        paddingVertical: 5,
        borderRadius: radius.pill,
        backgroundColor: background,
        borderWidth: 1,
        borderColor: suggested ? colors.hairlineStrong : 'transparent',
        borderStyle: suggested ? 'dashed' : 'solid',
      })}
    >
      {suggested ? <Ionicons name="add" size={13} color={colors.inkSecondary} /> : null}
      <Text
        variant="caption"
        color={suggested ? colors.inkSecondary : ink}
        style={{ fontWeight: '700' }}
      >
        {`#${tag}`}
      </Text>
      {onRemove ? <Ionicons name="close" size={13} color={ink} /> : null}
    </Pressable>
  );
}

/** "12 Mar 2026" */
export function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One file in a list: thumbnail, title, where it is (or when it was added),
 * kind and size, and its first few tags.
 */
export function FileRow({
  file,
  folderPath,
  first,
  onPress,
  onLongPress,
}: {
  file: DocFile;
  /** Shown instead of the date — in search results, where WHERE matters. */
  folderPath?: string;
  first: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const tags = (file.tags ?? '').split(' ').filter(Boolean);
  const size = formatBytes(file.sizeBytes);
  const meta = [
    folderPath !== undefined ? folderPath || 'Documents' : shortDate(file.createdAt),
    FILE_KIND_LABEL[kindOfDoc(file)],
    size,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${file.title}, ${meta}`}
      accessibilityHint="Shows a preview"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <FileThumb file={file} width={46} height={56} />
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {file.pinned ? <Ionicons name="pin" size={13} color={colors.accent} /> : null}
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {file.title}
          </Text>
        </View>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {meta}
        </Text>
        {tags.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 4, overflow: 'hidden' }}>
            {tags.slice(0, 3).map((tag) => (
              <View
                key={tag}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: radius.pill,
                  backgroundColor: colors.surfaceSunken,
                }}
              >
                <Text variant="caption" tone="secondary" style={{ fontSize: 11 }} numberOfLines={1}>
                  {`#${tag}`}
                </Text>
              </View>
            ))}
            {tags.length > 3 ? (
              <Text variant="caption" tone="muted" style={{ fontSize: 11 }}>
                {`+${tags.length - 3}`}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
    </Pressable>
  );
}

/** One file in the grid view: a big thumbnail, the title under it. */
export function FileCard({
  file,
  width,
  onPress,
  onLongPress,
}: {
  file: DocFile;
  width: number;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={file.title}
      accessibilityHint="Shows a preview"
      style={({ pressed }) => ({ width, gap: space.xs, opacity: pressed ? 0.75 : 1 })}
    >
      <View>
        <FileThumb file={file} width={width} height={Math.round(width * 1.25)} />
        {file.pinned ? (
          <View
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
            }}
          >
            <Ionicons name="pin" size={12} color={colors.accent} />
          </View>
        ) : null}
      </View>
      <Text variant="caption" numberOfLines={2} style={{ fontWeight: '600', color: colors.ink }}>
        {file.title}
      </Text>
    </Pressable>
  );
}

/** A folder: its colour, its name, and how much is inside (subfolders included). */
export function FolderTile({
  folder,
  fileCount,
  folderCount,
  width,
  onPress,
  onLongPress,
}: {
  folder: DocFolder;
  fileCount: number;
  folderCount: number;
  width: number;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors, mode, radius, space, shadow } = useTheme();
  const hue = folder.color ?? FOLDER_DEFAULT_COLOR;
  const wash = washFor(hue, mode);
  const ink = readableOn(hue, wash);
  const contents = [
    folderCount > 0 ? `${folderCount} ${folderCount === 1 ? 'folder' : 'folders'}` : null,
    `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={`${folder.name} folder, ${contents}`}
      accessibilityHint="Opens the folder. Long press for options."
      style={({ pressed }) => [
        {
          width,
          padding: space.md,
          gap: space.sm,
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
          opacity: pressed ? 0.8 : 1,
        },
        shadow.card,
      ]}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          backgroundColor: wash,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={(folder.icon as never) ?? 'folder'} size={22} color={ink} />
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {folder.name}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {contents}
        </Text>
      </View>
    </Pressable>
  );
}

/** The dashed "New folder" slot at the end of the folder grid. */
export function NewFolderTile({ width, onPress }: { width: number; onPress: () => void }) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New folder"
      style={({ pressed }) => ({
        width,
        minHeight: 104,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: colors.hairlineStrong,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Ionicons name="add" size={22} color={colors.inkSecondary} />
      <Text variant="small" tone="secondary" style={{ fontWeight: '600' }}>
        New folder
      </Text>
    </Pressable>
  );
}
