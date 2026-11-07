import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Switch, TextInput, View } from 'react-native';
import { Field } from '~/shared/components/forms';
import { BottomSheet, GradientButton, Label, Row, Text } from '~/shared/components/ui';
import { useModalClose } from '~/shared/hooks/useModalClose';
import { attachmentGate } from '~/shared/lib/attachmentGate';
import { FILE_KIND_LABEL, fileKindOf, formatBytes, safeExtension } from '~/shared/lib/fileKinds';
import { localRef } from '~/shared/lib/imageRef';
import { deletePersistedImage, persistPickedFile } from '~/shared/lib/imageStorage';
import { docFileRepo, docFolderRepo } from '~/db/repositories/documents';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { TagChip } from '~/features/documents/components/DocParts';
import { FileThumb } from '~/features/documents/components/FileThumb';
import { FolderPicker } from '~/features/documents/components/FolderPicker';
import { SourceChoices, useDocPicker, type PickedDoc } from '~/features/documents/components/useDocPicker';
import { generateTags, parseTags, serialiseTags, titleFromFileName } from '~/features/documents/logic/tags';

/**
 * Add or edit one document: the file, what it is, a description, its tags and
 * where it is filed.
 *
 * ## Tags write themselves
 *
 * While the user has not touched the tags, they FOLLOW the title and the
 * description — type "Passport renewal" and #identity #passport #renewal
 * appear as you go. The first tag removed or added by hand switches that off,
 * and from then on the generator only offers its ideas as dashed "+" chips. So
 * the common case is zero effort, and the user is never fighting an
 * auto-complete that undoes their edits.
 */
export default function DocumentFileForm() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const params = useLocalSearchParams<{
    id?: string;
    folder?: string;
    uri?: string;
    name?: string;
    mime?: string;
    size?: string;
  }>();
  const picker = useDocPicker();

  const existing = useMemo(() => (params.id ? docFileRepo.byId(params.id) : undefined), [params.id]);
  const folders = useMemo(() => docFolderRepo.all(), []);

  /** A newly picked file, not yet copied into the app's storage. */
  const [picked, setPicked] = useState<PickedDoc | null>(
    params.uri
      ? {
          uri: params.uri,
          name: params.name ?? 'Document',
          mimeType: params.mime ?? 'application/octet-stream',
          size: params.size ? Number(params.size) : null,
        }
      : null,
  );
  const [title, setTitle] = useState(existing?.title ?? titleFromFileName(params.name));
  const [description, setDescription] = useState(existing?.description ?? '');
  const [folderId, setFolderId] = useState<string | null>(existing?.folderId ?? params.folder ?? null);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  /** Null = automatic (follow title and description). */
  const [manualTags, setManualTags] = useState<string[] | null>(
    existing ? parseTags(existing.tags) : null,
  );
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const fileName = picked?.name ?? existing?.fileName ?? null;
  const suggestions = useMemo(
    () => generateTags({ title, description, fileName }),
    [title, description, fileName],
  );
  const tags = manualTags ?? suggestions;
  const extraSuggestions = suggestions.filter((t) => !tags.includes(t));

  const hasFile = picked !== null || Boolean(existing?.imageUri);
  const canSave = title.trim().length > 0 && hasFile && !saving;

  function removeTag(tag: string) {
    setManualTags(tags.filter((t) => t !== tag));
  }

  function addTags(raw: string) {
    const added = parseTags(raw);
    if (added.length === 0) return;
    setManualTags([...tags, ...added.filter((t) => !tags.includes(t))]);
    setTagDraft('');
  }

  async function choose(source: Parameters<typeof picker.pick>[0]) {
    const next = await picker.pick(source);
    if (!next) return;
    setPicked(next);
    if (!title.trim()) setTitle(titleFromFileName(next.name));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      let imageUri = existing?.imageUri ?? null;
      let sizeBytes = existing?.sizeBytes ?? null;
      let mimeType = existing?.mimeType ?? null;
      let storedName = existing?.fileName ?? null;

      if (picked) {
        const copied = await persistPickedFile(picked.uri, safeExtension(picked.name, picked.mimeType === 'image/jpeg' ? 'jpg' : 'bin'));
        // Replacing: the old file is no longer referenced by anything.
        if (existing?.imageUri) deletePersistedImage(existing.imageUri);
        imageUri = localRef(copied);
        sizeBytes = picked.size;
        mimeType = picked.mimeType;
        storedName = picked.name;
      }

      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        tags: serialiseTags(tags),
        folderId,
        pinned,
        imageUri,
        fileName: storedName,
        mimeType,
        sizeBytes,
      };
      if (existing) docFileRepo.update(existing.id, fields);
      else docFileRepo.create(fields);

      // Upload to Drive in the background, as every attachment does.
      if (picked) attachmentGate().afterAttach();
      router.back();
    } catch (error) {
      Alert.alert('Could not save', error instanceof Error ? error.message : 'The file could not be copied.');
      setSaving(false);
    }
  }

  const kind = fileKindOf(fileName ?? existing?.imageUri);
  const sizeLabel = formatBytes(picked?.size ?? existing?.sizeBytes ?? null);

  return (
    <BottomSheet
      visible
      asRoute
      scroll
      onClose={closeModal}
      title={existing ? 'Edit document' : 'New document'}
      icon="document-attach-outline"
      iconColor="#CA8A04"
      footer={
        <GradientButton
          label={existing ? 'Save changes' : 'Save document'}
          icon="checkmark"
          disabled={!canSave}
          onPress={() => void save()}
        />
      }
    >
      {picker.driveSheet}

      {/* The file leads: it is the reason this form exists. */}
      {hasFile ? (
        <View style={{ gap: space.sm }}>
          <Label>FILE</Label>
          <Row
            gap={space.md}
            style={{
              padding: space.md,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.hairline,
              backgroundColor: colors.surface,
            }}
          >
            {picked && kind === 'image' ? (
              <Image source={{ uri: picked.uri }} style={{ width: 64, height: 80, borderRadius: radius.sm }} />
            ) : (
              <FileThumb
                file={{ imageUri: picked?.uri ?? existing?.imageUri ?? null, fileName, title }}
                width={64}
                height={80}
              />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {fileName ?? 'Attached file'}
              </Text>
              <Text variant="caption" tone="secondary">
                {[FILE_KIND_LABEL[kind], sizeLabel].filter(Boolean).join(' · ')}
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert('Replace file', undefined, [
                    { text: 'Take a photo', onPress: () => setTimeout(() => void choose('camera'), 350) },
                    { text: 'Choose a photo', onPress: () => setTimeout(() => void choose('library'), 350) },
                    { text: 'Browse files', onPress: () => setTimeout(() => void choose('files'), 350) },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
                accessibilityRole="button"
                hitSlop={8}
                style={{ marginTop: space.xs, alignSelf: 'flex-start' }}
              >
                <Text variant="small" color={colors.accent} style={{ fontWeight: '700' }}>
                  Replace file
                </Text>
              </Pressable>
            </View>
          </Row>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Label>ADD A FILE</Label>
          <SourceChoices onChoose={(source) => void choose(source)} />
        </View>
      )}

      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Passport — Lahiru" />

      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="What it is and anything worth finding it by — numbers, dates, who issued it"
        multiline
      />

      {/* Tags: generated live until edited by hand. */}
      <View style={{ gap: space.sm }}>
        <Row justify="space-between" align="center">
          <Label>TAGS</Label>
          {manualTags === null && tags.length > 0 ? (
            <Row gap={4}>
              <Ionicons name="sparkles-outline" size={12} color={colors.accent} />
              <Text variant="caption" color={colors.accentInk} style={{ fontWeight: '700' }}>
                Suggested from your text
              </Text>
            </Row>
          ) : manualTags !== null ? (
            <Pressable onPress={() => setManualTags(null)} hitSlop={8} accessibilityRole="button">
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Reset to suggested
              </Text>
            </Pressable>
          ) : null}
        </Row>

        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: space.xs + 2,
            padding: space.sm,
            minHeight: 48,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            backgroundColor: colors.surface,
          }}
        >
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} onRemove={() => removeTag(tag)} />
          ))}
          <TextInput
            value={tagDraft}
            onChangeText={(text) => (/[,\s]$/.test(text) ? addTags(text) : setTagDraft(text))}
            onSubmitEditing={() => addTags(tagDraft)}
            placeholder={tags.length === 0 ? 'Add tags — type and press space' : 'Add tag'}
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            blurOnSubmit={false}
            accessibilityLabel="Add a tag"
            style={{ flexGrow: 1, minWidth: 90, paddingVertical: 6, paddingHorizontal: 4, fontSize: 15, color: colors.ink }}
          />
        </View>

        {extraSuggestions.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 }}>
            {extraSuggestions.map((tag) => (
              <TagChip key={tag} tag={tag} suggested onPress={() => setManualTags([...tags, tag])} />
            ))}
          </View>
        ) : null}
      </View>

      <FolderPicker folders={folders} value={folderId} onChange={setFolderId} />

      <Row
        justify="space-between"
        align="center"
        style={{
          padding: space.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.hairline,
          backgroundColor: colors.surface,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Pin to top</Text>
          <Text variant="caption" tone="secondary">
            Shown first in its folder and on the home screen
          </Text>
        </View>
        <Switch value={pinned} onValueChange={setPinned} accessibilityLabel="Pin to top" />
      </Row>

      {saving ? <ActivityIndicator color={colors.accent} /> : null}

      <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.xs }}>
        Saved on this phone, and copied to your Google Drive under Documents, in the same folders, when
        Drive is connected.
      </Text>
    </BottomSheet>
  );
}
