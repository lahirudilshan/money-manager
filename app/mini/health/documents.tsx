import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Empty, GradientButton, Label, Row, Surface, Text } from '../../../src/components/ui';
import { Screen } from '../../../src/components/Screen';
import { healthDocumentRepo } from '../../../src/db/repositories';
import { DOCUMENT_KIND_LABEL, type DocumentKind, type HealthDocument } from '../../../src/db/schema';
import { useAppStore } from '../../../src/store/useAppStore';
import { useTheme } from '../../../src/theme/ThemeProvider';

/**
 * Prescriptions, reports and scans — as a gallery, and readable full-screen.
 *
 * The gap this fills was the worst one in the feature: documents could be
 * photographed and then never looked at again. Tapping one on the timeline did
 * nothing, there was no list of them, and no viewer — so the app was asking
 * people to photograph a prescription into a hole. The camera roll at least
 * lets you open the picture.
 *
 * A grid rather than a list, because these are IMAGES: a thumbnail identifies a
 * prescription far faster than its title does, and two columns fit a phone
 * without shrinking them past recognition.
 */
export default function HealthDocuments() {
  const { colors, space, radius } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ person?: string }>();
  const store = useAppStore();

  const person =
    store.healthPeople.find((p) => p.id === params.person) ?? store.healthPeople[0];

  const documents = useMemo(
    () => (person ? healthDocumentRepo.byPerson(person.id) : []),
    [person, store.healthPeople],
  );

  /** Which document is open full-screen, or null. */
  const [viewing, setViewing] = useState<HealthDocument | null>(null);

  /** Filter by kind — a prescription and a bill are looked for differently. */
  const [kind, setKind] = useState<DocumentKind | null>(null);
  const kinds = useMemo(() => {
    const seen = new Set(documents.map((document) => document.kind));
    return [...seen] as DocumentKind[];
  }, [documents]);

  const shown = kind ? documents.filter((document) => document.kind === kind) : documents;

  function remove(document: HealthDocument) {
    Alert.alert(
      `Delete "${document.title}"?`,
      'The photo is removed from this phone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            healthDocumentRepo.remove(document.id);
            store.refresh();
            setViewing(null);
          },
        },
      ],
    );
  }

  if (!person) {
    return (
      <Screen title="Documents" onBack={() => router.back()}>
        <Text variant="small" tone="secondary">
          Add a person first.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen
      title={`${person.name}'s documents`}
      onBack={() => router.back()}
      footer={
        <GradientButton
          label="Add a document"
          icon="camera-outline"
          onPress={() => router.push(`/mini/health/document?person=${person.id}`)}
        />
      }
    >
      {documents.length === 0 ? (
        <Empty
          icon="document-text-outline"
          title="No documents yet"
          message="Photograph a prescription or report and it is kept here, readable any time — before the paper gets lost."
          actionLabel="Add a document"
          onAction={() => router.push(`/mini/health/document?person=${person.id}`)}
        />
      ) : (
        <>
          {kinds.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }}
            >
              <FilterChip label="All" selected={kind === null} onPress={() => setKind(null)} />
              {kinds.map((key) => (
                <FilterChip
                  key={key}
                  label={DOCUMENT_KIND_LABEL[key]}
                  selected={kind === key}
                  onPress={() => setKind(key)}
                />
              ))}
            </ScrollView>
          ) : null}

          {/* Two-column grid of thumbnails. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {shown.map((document) => (
              <Pressable
                key={document.id}
                onPress={() => setViewing(document)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${document.title}`}
                style={({ pressed }) => ({
                  // Two per row, accounting for the gap between them.
                  width: '48.5%',
                  opacity: pressed ? 0.8 : 1,
                  gap: 6,
                })}
              >
                <View
                  style={{
                    aspectRatio: 3 / 4,
                    borderRadius: radius.md,
                    backgroundColor: colors.surfaceSunken,
                    overflow: 'hidden',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.hairline,
                  }}
                >
                  {document.imageUri ? (
                    <Image
                      source={{ uri: document.imageUri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    // A document with no photo is still a record — its title
                    // and summary may be all that was kept.
                    <Ionicons name="document-text-outline" size={30} color={colors.inkMuted} />
                  )}
                </View>
                <Text variant="caption" numberOfLines={1} style={{ fontWeight: '700' }}>
                  {document.title}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 10 }}>
                  {DOCUMENT_KIND_LABEL[document.kind]} ·{' '}
                  {document.documentDate.toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {/*
        The viewer.

        Full-screen and black, because the content is a photographed sheet of
        paper — the surrounding chrome of a normal screen competes with it, and
        a prescription is often read in bad light where every pixel of size
        helps. `resizeMode="contain"` so nothing is cropped away: a dose written
        in the margin is exactly the part that would be lost.
      */}
      <Modal
        visible={viewing !== null}
        animationType="fade"
        presentationStyle="overFullScreen"
        transparent
        onRequestClose={() => setViewing(null)}
      >
        {viewing ? <DocumentViewer document={viewing} onClose={() => setViewing(null)} onDelete={() => remove(viewing)} /> : null}
      </Modal>
    </Screen>
  );
}

/** The full-screen reader for one document. */
function DocumentViewer({
  document,
  onClose,
  onDelete,
}: {
  document: HealthDocument;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {/* Controls float over the image rather than taking height from it. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + space.sm,
          left: space.lg,
          right: space.lg,
          zIndex: 2,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
          })}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" color="#FFFFFF" numberOfLines={1}>
            {document.title}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1}>
            {DOCUMENT_KIND_LABEL[document.kind]} ·{' '}
            {document.documentDate.toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </Text>
        </View>

        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${document.title}`}
          hitSlop={12}
          style={({ pressed }) => ({
            opacity: pressed ? 0.6 : 1,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.55)',
          })}
        >
          <Ionicons name="trash-outline" size={19} color="#FFFFFF" />
        </Pressable>
      </View>

      {/*
        Pinch-to-zoom via a ScrollView.

        A photographed report is often typed at 8pt and shot from a distance, so
        reading it back means zooming. A plain <Image> cannot, and adding a
        gesture library for one screen is not worth it — a ScrollView with
        min/max zoom is the standard trick and needs no new dependency.
      */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flex: 1 }}
        maximumZoomScale={4}
        minimumZoomScale={1}
        centerContent
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        {document.imageUri ? (
          <Image
            source={{ uri: document.imageUri }}
            style={{ flex: 1 }}
            resizeMode="contain"
            accessibilityLabel={document.title}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
            <Ionicons name="document-text-outline" size={44} color="rgba(255,255,255,0.5)" />
            <Text variant="small" color="rgba(255,255,255,0.7)">
              No photo on this document
            </Text>
          </View>
        )}
      </ScrollView>

      {/* What the user typed about it, over the foot of the image. */}
      {document.summary ? (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: space.lg,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.md,
            backgroundColor: 'rgba(0,0,0,0.65)',
          }}
        >
          <Label color="rgba(255,255,255,0.6)">NOTES</Label>
          <Text variant="small" color="#FFFFFF">
            {document.summary}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.accent : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.hairline,
      })}
    >
      <Text
        variant="small"
        color={selected ? colors.inkInverse : colors.inkSecondary}
        style={{ fontWeight: selected ? '700' : '500' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
