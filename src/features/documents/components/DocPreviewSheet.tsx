import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Image, Pressable, View } from 'react-native';
import { canRenderPdf, safeDecode, useDocumentViewer } from '~/shared/components/DocumentViewer';
import { BottomSheet, GradientButton, Label, Row, Text } from '~/shared/components/ui';
import { openAttachment } from '~/shared/lib/attachmentPicker';
import { extensionOf, FILE_KIND_LABEL, formatBytes, type FileKind } from '~/shared/lib/fileKinds';
import { docFileRepo } from '~/db/repositories/documents';
import type { DocFile } from '~/db/schema';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { kindOfDoc } from '../logic/search';
import { shortDate, TagChip } from './DocParts';
import { FileThumb, resolveDocPath } from './FileThumb';

/** Long enough for the sheet's dismiss animation before the next modal shows. */
const SHEET_HANDOFF_MS = 450;

/**
 * The quick look before the full view: a live preview of the first page (or
 * the photo), what it is, where it lives, its notes and tags, and every action
 * — so most questions ("is this the 2025 one?") are answered without opening
 * the file at all.
 *
 * Returns `open(file)` and the element to render once in the screen. The full
 * viewer is a separate modal, opened after this sheet has gone: iOS will not
 * present a second modal over a page sheet that is still on screen.
 */
export function useDocPreview({
  folderPathOf,
  onChanged,
  onTag,
}: {
  /** "Car / Insurance" for a file's folder. */
  folderPathOf: (folderId: string | null) => string;
  /** A file was pinned, edited or deleted — re-read. */
  onChanged: () => void;
  /** A tag was tapped: search by it. */
  onTag?: (tag: string) => void;
}) {
  const router = useRouter();
  const [file, setFile] = React.useState<DocFile | null>(null);
  const viewer = useDocumentViewer();

  const close = () => setFile(null);

  function openFull(target: DocFile) {
    close();
    setTimeout(
      () =>
        viewer.open({
          id: target.id,
          title: target.title,
          imageUri: target.imageUri,
          documentDate: target.createdAt,
          summary: target.description,
          kindLabel: FILE_KIND_LABEL[kindOfDoc(target)],
          extension: extensionOf(target.fileName) || undefined,
        }),
      SHEET_HANDOFF_MS,
    );
  }

  function togglePin(target: DocFile) {
    const updated = docFileRepo.update(target.id, { pinned: !target.pinned });
    if (updated) setFile(updated);
    onChanged();
  }

  function edit(target: DocFile) {
    close();
    setTimeout(() => router.push(`/mini/documents/file?id=${target.id}`), SHEET_HANDOFF_MS);
  }

  function remove(target: DocFile) {
    Alert.alert(`Delete "${target.title}"?`, 'The file is removed from this phone. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          docFileRepo.remove(target.id, target);
          close();
          onChanged();
        },
      },
    ]);
  }

  const element = (
    <>
      <BottomSheet
        visible={file !== null}
        onClose={close}
        scroll
        wrapTitle
        title={file?.title ?? ''}
        eyebrow={file ? folderPathOf(file.folderId) || 'Documents' : undefined}
        icon="eye-outline"
        iconColor="#CA8A04"
        footer={
          file ? (
            <GradientButton label="Open full view" icon="expand-outline" onPress={() => openFull(file)} />
          ) : null
        }
      >
        {file ? (
          <PreviewBody
            file={file}
            onOpen={() => openFull(file)}
            onTag={
              onTag
                ? (tag) => {
                    close();
                    onTag(tag);
                  }
                : undefined
            }
            onPin={() => togglePin(file)}
            onEdit={() => edit(file)}
            onDelete={() => remove(file)}
          />
        ) : null}
      </BottomSheet>
      {viewer.viewer}
    </>
  );

  return { open: setFile, element };
}

function PreviewBody({
  file,
  onOpen,
  onTag,
  onPin,
  onEdit,
  onDelete,
}: {
  file: DocFile;
  onOpen: () => void;
  onTag?: (tag: string) => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { colors, radius, space } = useTheme();
  const path = resolveDocPath(file);
  const kind = kindOfDoc(file);
  const tags = (file.tags ?? '').split(' ').filter(Boolean);

  return (
    <>
      {/* The preview pane. Tapping it is the same as "Open full view". */}
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${file.title} full screen`}
        style={{
          height: 300,
          borderRadius: radius.lg,
          overflow: 'hidden',
          backgroundColor: colors.surfaceSunken,
          borderWidth: 1,
          borderColor: colors.hairline,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {path && kind === 'image' ? (
          <Image source={{ uri: path }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        ) : path && canRenderPdf() && livePreviewable(kind, path) ? (
          <WebPreview uri={path} />
        ) : (
          <View style={{ alignItems: 'center', gap: space.sm }}>
            <FileThumb file={file} width={96} height={120} />
            <Text variant="caption" tone="secondary">
              {path ? 'Tap to open' : file.imageUri ? 'In Google Drive — downloads shortly' : 'No file attached'}
            </Text>
          </View>
        )}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: space.sm,
            bottom: space.sm,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: space.sm,
            paddingVertical: 4,
            borderRadius: radius.pill,
            backgroundColor: colors.surface,
          }}
        >
          <Ionicons name="expand-outline" size={12} color={colors.inkSecondary} />
          <Text variant="caption" tone="secondary" style={{ fontWeight: '700' }}>
            Full view
          </Text>
        </View>
      </Pressable>

      {/* Quick actions. */}
      <Row gap={space.sm}>
        <ActionTile icon={file.pinned ? 'pin' : 'pin-outline'} label={file.pinned ? 'Unpin' : 'Pin'} onPress={onPin} />
        <ActionTile icon="create-outline" label="Edit" onPress={onEdit} />
        <ActionTile
          icon="share-outline"
          label="Share"
          disabled={!path}
          onPress={() => path && void openAttachment(path)}
        />
        <ActionTile icon="trash-outline" label="Delete" danger onPress={onDelete} />
      </Row>

      {file.description ? (
        <View style={{ gap: space.sm }}>
          <Label>DESCRIPTION</Label>
          <Text variant="body" tone="secondary" selectable>
            {file.description}
          </Text>
        </View>
      ) : null}

      {tags.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <Label>TAGS</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 }}>
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} onPress={onTag ? () => onTag(tag) : undefined} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Label>DETAILS</Label>
        <View
          style={{
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.hairline,
            backgroundColor: colors.surface,
          }}
        >
          <Detail first label="Type" value={FILE_KIND_LABEL[kind]} />
          <Detail label="File name" value={file.fileName} />
          <Detail label="Size" value={formatBytes(file.sizeBytes)} />
          <Detail label="Added" value={shortDate(file.createdAt)} />
          <Detail label="Backed up" value={file.imageUri?.includes('drive:') ? 'In Google Drive' : 'On this phone only'} />
        </View>
      </View>
    </>
  );
}

function Detail({ label, value, first = false }: { label: string; value: string | null; first?: boolean }) {
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.hairline,
      }}
    >
      <Text variant="small" tone="secondary">
        {label}
      </Text>
      <Text
        variant="small"
        tone={value ? 'ink' : 'muted'}
        numberOfLines={1}
        style={{ flexShrink: 1, textAlign: 'right', fontWeight: '600' }}
      >
        {value ?? 'Not set'}
      </Text>
    </View>
  );
}

function ActionTile({
  icon,
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors, radius, space } = useTheme();
  const ink = danger ? colors.danger : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        gap: 4,
        paddingVertical: space.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.surfaceSunken : danger ? colors.dangerSoft : colors.surface,
        borderWidth: danger ? 0 : 1,
        borderColor: colors.hairline,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={ink} />
      <Text variant="caption" color={ink} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The first page, live — WebKit renders PDF, Office and text natively. Not
 * interactive here: a tap opens the full view instead of scrolling a tiny pane.
 */
/**
 * Kinds drawn live in the preview pane. Not markup: an imported .html would be
 * rendered as a page, and even with scripts off that is not a preview of a
 * document. Audio, archives and unknown files have nothing to draw.
 */
const LIVE_KINDS: ReadonlySet<FileKind> = new Set(['pdf', 'doc', 'sheet', 'slides', 'text', 'video']);
function livePreviewable(kind: FileKind, path: string): boolean {
  return LIVE_KINDS.has(kind) && !/\.(html?|xhtml|svg|xml)$/i.test(path);
}

function WebPreview({ uri }: { uri: string }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview');
  const { colors } = useTheme();
  return (
    <View pointerEvents="none" style={{ width: '100%', height: '100%' }}>
      <WebView
        source={{ uri }}
        /*
         * Locked to this one file, same as the full viewer: no scripts, no
         * read access beyond the file itself, no navigation away from it — so
         * a hostile attachment cannot read the user's other documents.
         */
        originWhitelist={['file://*']}
        javaScriptEnabled={false}
        allowFileAccess
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        allowingReadAccessToURL={uri}
        onShouldStartLoadWithRequest={(request) => safeDecode(request.url) === safeDecode(uri)}
        scrollEnabled={false}
        style={{ flex: 1, backgroundColor: colors.surfaceSunken }}
        containerStyle={{ backgroundColor: colors.surfaceSunken }}
      />
    </View>
  );
}
