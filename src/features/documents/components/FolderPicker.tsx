import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Label, Text } from '~/shared/components/ui';
import type { DocFolder } from '~/db/schema';
import { readableOn, washFor } from '~/shared/theme';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { flattenTree, pathLabel } from '../logic/folders';
import { FOLDER_DEFAULT_COLOR } from './DocParts';

/**
 * "Save in" — the current folder as one row; tap to see the whole tree,
 * indented, and pick any level. Collapsed by default so the form stays short
 * for the common case of saving where you already are.
 */
export function FolderPicker({
  label = 'SAVE IN',
  folders,
  value,
  onChange,
  exclude,
}: {
  label?: string;
  folders: DocFolder[];
  value: string | null;
  onChange: (folderId: string | null) => void;
  /** A folder being moved cannot go inside itself. */
  exclude?: string;
}) {
  const { colors, radius, space } = useTheme();
  const [open, setOpen] = useState(false);
  const tree = flattenTree(folders, { exclude });
  const current = pathLabel(folders, value) || 'Documents (top level)';

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <View style={{ gap: space.sm }}>
      <Label>{label}</Label>
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: open ? colors.accent : colors.hairlineStrong,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={`Save in ${current}. ${open ? 'Hide' : 'Show'} folders`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            padding: space.md,
            backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
          })}
        >
          <Ionicons name="folder-open-outline" size={20} color={colors.inkSecondary} />
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {current}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.inkMuted} />
        </Pressable>

        {open ? (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.hairline }}>
            <FolderOption name="Documents (top level)" depth={0} selected={value === null} onPress={() => choose(null)} />
            {tree.map(({ folder, depth }) => (
              <FolderOption
                key={folder.id}
                name={folder.name}
                color={folder.color ?? FOLDER_DEFAULT_COLOR}
                depth={depth + 1}
                selected={value === folder.id}
                onPress={() => choose(folder.id)}
              />
            ))}
            {tree.length === 0 ? (
              <Text variant="caption" tone="secondary" style={{ padding: space.md }}>
                No folders yet. Create one from the Documents screen.
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function FolderOption({
  name,
  depth,
  selected,
  color,
  onPress,
}: {
  name: string;
  depth: number;
  selected: boolean;
  color?: string;
  onPress: () => void;
}) {
  const { colors, mode, space } = useTheme();
  const ink = color ? readableOn(color, washFor(color, mode)) : colors.inkSecondary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.sm + 2,
        paddingRight: space.md,
        paddingLeft: space.md + Math.min(depth, 6) * 18,
        backgroundColor: selected ? colors.accentSoft : pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      {depth > 0 ? <Ionicons name="return-down-forward" size={13} color={colors.inkFaint} /> : null}
      <Ionicons name={depth === 0 ? 'home-outline' : 'folder'} size={17} color={depth === 0 ? colors.inkSecondary : ink} />
      <Text variant="body" numberOfLines={1} style={{ flex: 1, fontWeight: selected ? '700' : '500' }}>
        {name}
      </Text>
      {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}
