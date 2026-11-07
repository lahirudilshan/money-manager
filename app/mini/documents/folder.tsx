import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ColorPicker, Field } from '~/shared/components/forms';
import { BottomSheet, GradientButton, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { suggestCategoryColor } from '~/shared/data/categoryColors';
import { docFolderRepo } from '~/db/repositories/documents';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { FOLDER_DEFAULT_COLOR } from '~/features/documents/components/DocParts';
import { FolderPicker } from '~/features/documents/components/FolderPicker';
import { canMoveInto, pathLabel } from '~/features/documents/logic/folders';

/**
 * Create a folder (inside `?parent=`), or rename, recolour and move one
 * (`?id=`). Moving offers every folder except this one and its own children —
 * a folder cannot be filed inside itself.
 */
export default function DocumentFolderForm() {
  const { space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{ id?: string; parent?: string }>();

  const folders = useMemo(() => docFolderRepo.all(), []);
  const existing = params.id ? folders.find((f) => f.id === params.id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? FOLDER_DEFAULT_COLOR);
  /** Whether the colour was picked by hand; until then it follows the name. */
  const [colorTouched, setColorTouched] = useState(Boolean(existing));
  const [parentId, setParentId] = useState<string | null>(existing?.parentId ?? params.parent ?? null);

  const suggested = colorTouched ? null : suggestCategoryColor(name);
  const shownColor = suggested ?? color;
  const trimmed = name.trim();
  const sibling = folders.find(
    (f) => f.id !== existing?.id && (f.parentId ?? null) === parentId && f.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const validMove = !existing || canMoveInto(folders, existing.id, parentId);
  const canSave = trimmed.length > 0 && !sibling && validMove;

  function save() {
    if (!canSave) return;
    const fields = { name: trimmed, color: shownColor, parentId };
    if (existing) docFolderRepo.update(existing.id, fields);
    else docFolderRepo.create(fields);
    router.back();
  }

  const where = pathLabel(folders, parentId) || 'Documents';

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title={existing ? 'Edit folder' : 'New folder'}
      eyebrow={existing ? undefined : `Inside ${where}`}
      icon="folder-outline"
      iconColor={shownColor}
      footer={
        <GradientButton
          label={existing ? 'Save folder' : 'Create folder'}
          icon="checkmark"
          disabled={!canSave}
          onPress={save}
        />
      }
    >
      <Field
        label="Folder name"
        value={name}
        onChangeText={setName}
        placeholder="Car, Insurance, 2026, Passports…"
        autoFocus={!existing}
        error={sibling ? `There is already a folder called ${sibling.name} here.` : undefined}
      />

      <ColorPicker
        label="Colour"
        value={shownColor}
        suggested={Boolean(suggested)}
        onChange={(next) => {
          setColor(next);
          setColorTouched(true);
        }}
      />

      {existing ? (
        <FolderPicker
          label="INSIDE"
          folders={folders}
          value={parentId}
          onChange={setParentId}
          exclude={existing.id}
        />
      ) : null}

      <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
        Folders can hold files and more folders, as deep as you like.
      </Text>
    </BottomSheet>
  );
}
