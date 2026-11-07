import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { Screen } from '~/shared/components/Screen';
import { Empty, GradientButton, Label, Row, Surface, Text } from '~/shared/components/ui';
import { docFolderRepo } from '~/db/repositories/documents';
import type { DocFile, DocFolder } from '~/db/schema';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { childrenOf, deepFileCounts, descendantIds, pathLabel, pathOf } from '~/features/documents/logic/folders';
import { searchDocs, topTags } from '~/features/documents/logic/search';
import { FileCard, FileRow, FolderTile, NewFolderTile, TagChip } from '~/features/documents/components/DocParts';
import { useDocPreview } from '~/features/documents/components/DocPreviewSheet';
import { AddSourceSheet, useDocPicker, useDocsData, type DocSource } from '~/features/documents/components/useDocPicker';

/** Long enough for a closing sheet to leave before the picker or a route shows. */
const HANDOFF_MS = 450;

type Layout = 'list' | 'grid';

/**
 * The Documents add-on: one folder's contents, or search across all of them.
 *
 * Each folder is its own pushed screen (`?folder=`), so the back chevron goes
 * up one level — the way Files works — and the breadcrumb says where you are.
 * Search is always across EVERYTHING, whatever folder it is typed in: someone
 * searching "passport" wants the passport, not a lecture about which folder
 * they are standing in. Each result says where it lives.
 */
export default function DocumentsScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ folder?: string; q?: string; focus?: string }>();
  const folderId = params.folder || null;

  const { folders, files, reload } = useDocsData();
  const [query, setQuery] = useState(params.q ?? '');
  const [layout, setLayout] = useState<Layout>('list');
  const [addOpen, setAddOpen] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const picker = useDocPicker();

  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;
  const crumbs = pathOf(folders, folderId);
  const subfolders = useMemo(() => childrenOf(folders, folderId), [folders, folderId]);
  const here = useMemo(
    () =>
      files
        .filter((f) => (f.folderId ?? null) === folderId)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.getTime() - a.createdAt.getTime()),
    [files, folderId],
  );
  const counts = useMemo(() => deepFileCounts(folders, files), [folders, files]);
  const tags = useMemo(() => topTags(files, 10), [files]);

  const searching = query.trim().length > 0;
  const hits = useMemo(() => (searching ? searchDocs(files, folders, query) : []), [searching, files, folders, query]);
  const folderHits = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 6);
  }, [searching, folders, query]);

  const folderPathOf = (id: string | null) => pathLabel(folders, id);
  const preview = useDocPreview({ folderPathOf, onChanged: reload, onTag: (tag) => setQuery(tag) });

  // Two columns of folders and three of grid files, inside the screen gutters.
  const inner = width - space.lg * 2;
  const folderWidth = (inner - space.md) / 2;
  const cardWidth = (inner - space.md * 2) / 3;

  function openFolder(target: DocFolder) {
    router.push(`/mini/documents?folder=${target.id}`);
  }

  function folderActions(target: DocFolder) {
    const inside = counts.get(target.id) ?? 0;
    const subCount = descendantIds(folders, target.id).length;
    Alert.alert(target.name, undefined, [
      { text: 'Open', onPress: () => openFolder(target) },
      { text: 'Rename or move', onPress: () => router.push(`/mini/documents/folder?id=${target.id}`) },
      { text: 'New folder inside', onPress: () => router.push(`/mini/documents/folder?parent=${target.id}`) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            `Delete "${target.name}"?`,
            inside + subCount > 0
              ? `This also deletes ${[
                  subCount > 0 ? `${subCount} ${subCount === 1 ? 'folder' : 'folders'}` : null,
                  inside > 0 ? `${inside} ${inside === 1 ? 'file' : 'files'}` : null,
                ]
                  .filter(Boolean)
                  .join(' and ')} inside it. This cannot be undone.`
              : 'The folder is empty.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  docFolderRepo.remove(target.id);
                  reload();
                },
              },
            ],
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function addFrom(source: DocSource) {
    setAddOpen(false);
    // Let the source sheet finish leaving: iOS drops a picker presented mid-dismiss.
    await new Promise((resolve) => setTimeout(resolve, HANDOFF_MS));
    const picked = await picker.pick(source);
    if (!picked) return;
    router.push({
      pathname: '/mini/documents/file',
      params: {
        uri: picked.uri,
        name: picked.name,
        mime: picked.mimeType,
        ...(picked.size != null ? { size: String(picked.size) } : {}),
        ...(folderId ? { folder: folderId } : {}),
      },
    } as never);
  }

  const title = folder?.name ?? 'Documents';
  const isEmpty = folders.length === 0 && files.length === 0;

  return (
    <Screen
      title={title}
      onBack={() => router.back()}
      action={{
        icon: 'folder-outline',
        label: 'New folder',
        onPress: () => router.push(`/mini/documents/folder${folderId ? `?parent=${folderId}` : ''}`),
      }}
      footer={<GradientButton label="Add document" icon="add" onPress={() => setAddOpen(true)} />}
    >
      {picker.driveSheet}

      {/* Breadcrumb — where this folder sits. Tapping a level opens it. */}
      {crumbs.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: 4 }}>
          <Crumb label="Documents" onPress={() => router.push('/mini/documents')} />
          {crumbs.map((c, i) => (
            <React.Fragment key={c.id}>
              <Ionicons name="chevron-forward" size={12} color={colors.inkMuted} />
              <Crumb
                label={c.name}
                current={i === crumbs.length - 1}
                onPress={i === crumbs.length - 1 ? undefined : () => openFolder(c)}
              />
            </React.Fragment>
          ))}
        </ScrollView>
      ) : null}

      {/* Search everything. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: searching ? colors.accent : colors.hairlineStrong,
        }}
      >
        <Ionicons name="search" size={18} color={colors.inkSecondary} />
        <TextInput
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          autoFocus={params.focus === '1'}
          placeholder="Search titles, notes, tags, folders"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="never"
          accessibilityLabel="Search documents"
          style={{ flex: 1, paddingVertical: space.md, fontSize: 15, color: colors.ink }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.inkMuted} />
          </Pressable>
        ) : null}
      </View>

      {!searching && tags.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}>
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} onPress={() => setQuery(tag)} />
          ))}
        </ScrollView>
      ) : null}

      {searching ? (
        <>
          <Text variant="caption" tone="secondary" style={{ paddingHorizontal: space.xs }}>
            {`${hits.length} ${hits.length === 1 ? 'document' : 'documents'}${
              folderHits.length > 0 ? ` · ${folderHits.length} ${folderHits.length === 1 ? 'folder' : 'folders'}` : ''
            } across all folders`}
          </Text>

          {folderHits.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>FOLDERS</Label>
              <Surface padded={false} style={{ overflow: 'hidden' }}>
                {folderHits.map((f, i) => (
                  <Pressable
                    key={f.id}
                    onPress={() => openFolder(f)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      padding: space.md,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: colors.hairline,
                      backgroundColor: pressed ? colors.surfaceSunken : 'transparent',
                    })}
                  >
                    <Ionicons name="folder" size={22} color={colors.inkSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{f.name}</Text>
                      <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {pathLabel(folders, f.parentId) || 'Documents'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
                  </Pressable>
                ))}
              </Surface>
            </View>
          ) : null}

          {hits.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <Label>DOCUMENTS</Label>
              <Surface padded={false} style={{ overflow: 'hidden' }}>
                {hits.map((hit, i) => (
                  <FileRow
                    key={hit.doc.id}
                    file={hit.doc}
                    folderPath={hit.folderPath}
                    first={i === 0}
                    onPress={() => preview.open(hit.doc)}
                  />
                ))}
              </Surface>
            </View>
          ) : folderHits.length === 0 ? (
            <Surface>
              <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
                <Ionicons name="search-outline" size={28} color={colors.inkMuted} />
                <Text variant="heading">Nothing matches</Text>
                <Text variant="small" tone="secondary" style={{ textAlign: 'center' }}>
                  Try fewer words, a tag like “insurance”, or a kind like “pdf” or “photos”.
                </Text>
              </View>
            </Surface>
          ) : null}
        </>
      ) : isEmpty ? (
        <Empty
          icon="folder-open-outline"
          title="Keep your important papers here"
          message="Passports, policies, deeds, warranties, certificates — as photos, PDFs or any file. Add a note and tags, file them in folders, and find any of them in seconds."
          actionLabel="Add your first document"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <>
          {/* Folders. The dashed slot is always last, so there is always a way in. */}
          <View style={{ gap: space.sm }}>
            <Label>{folder ? 'FOLDERS IN HERE' : 'FOLDERS'}</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
              {subfolders.map((f) => (
                <FolderTile
                  key={f.id}
                  folder={f}
                  width={folderWidth}
                  fileCount={counts.get(f.id) ?? 0}
                  folderCount={childrenOf(folders, f.id).length}
                  onPress={() => openFolder(f)}
                  onLongPress={() => folderActions(f)}
                />
              ))}
              <NewFolderTile
                width={folderWidth}
                onPress={() => router.push(`/mini/documents/folder${folderId ? `?parent=${folderId}` : ''}`)}
              />
            </View>
          </View>

          {/* Files directly in this folder. */}
          <View style={{ gap: space.sm }}>
            <Row justify="space-between" align="center">
              <Label>{`FILES${here.length > 0 ? ` · ${here.length}` : ''}`}</Label>
              {here.length > 0 ? <LayoutToggle value={layout} onChange={setLayout} /> : null}
            </Row>
            {here.length === 0 ? (
              <Surface>
                <Pressable
                  onPress={() => setAddOpen(true)}
                  accessibilityRole="button"
                  style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.sm }}
                >
                  <Ionicons name="document-attach-outline" size={26} color={colors.inkMuted} />
                  <Text variant="small" tone="secondary" style={{ textAlign: 'center' }}>
                    {folder ? `Nothing in ${folder.name} yet.` : 'No loose files here.'} Tap to add one.
                  </Text>
                </Pressable>
              </Surface>
            ) : layout === 'list' ? (
              <Surface padded={false} style={{ overflow: 'hidden' }}>
                {here.map((file, i) => (
                  <FileRow key={file.id} file={file} first={i === 0} onPress={() => preview.open(file)} />
                ))}
              </Surface>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                {here.map((file: DocFile) => (
                  <FileCard key={file.id} file={file} width={cardWidth} onPress={() => preview.open(file)} />
                ))}
              </View>
            )}
          </View>

          {subfolders.length > 0 ? (
            <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              Long press a folder to rename, move or delete it.
            </Text>
          ) : null}
        </>
      )}

      <AddSourceSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onChoose={(source) => void addFrom(source)}
        folderName={folder?.name}
      />
      {preview.element}
    </Screen>
  );
}

function Crumb({ label, current = false, onPress }: { label: string; current?: boolean; onPress?: () => void }) {
  const { colors, radius, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => ({
        paddingHorizontal: space.sm,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: current ? colors.accentSoft : pressed ? colors.surfaceSunken : 'transparent',
      })}
    >
      <Text variant="caption" color={current ? colors.accentInk : colors.inkSecondary} style={{ fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function LayoutToggle({ value, onChange }: { value: Layout; onChange: (next: Layout) => void }) {
  const { colors, radius } = useTheme();
  const option = (key: Layout, icon: keyof typeof Ionicons.glyphMap, label: string) => (
    <Pressable
      onPress={() => onChange(key)}
      accessibilityRole="button"
      accessibilityState={{ selected: value === key }}
      accessibilityLabel={label}
      hitSlop={6}
      style={{
        width: 32,
        height: 28,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: value === key ? colors.surface : 'transparent',
      }}
    >
      <Ionicons name={icon} size={16} color={value === key ? colors.ink : colors.inkMuted} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', padding: 2, gap: 2, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }}>
      {option('list', 'list-outline', 'List view')}
      {option('grid', 'grid-outline', 'Grid view')}
    </View>
  );
}
