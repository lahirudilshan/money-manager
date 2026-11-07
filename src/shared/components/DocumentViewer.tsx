import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, UIManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Label, Text } from '~/shared/components/ui';
import { openAttachment } from '~/shared/lib/attachmentPicker';
import { resolveImageUri } from '~/shared/lib/imageCache';
import { fileKindOf } from '~/shared/lib/fileKinds';
import { useTheme } from '~/shared/theme/ThemeProvider';

/** What the viewer needs from a document — a `HealthDocument` row satisfies it. */
export interface ViewableDocument {
  id: string;
  title: string;
  imageUri: string | null;
  documentDate: Date;
  summary?: string | null;
  /** Shown beside the date, e.g. "Lab report". */
  kindLabel?: string;
  /**
   * The file's own extension, when it may be neither JPG nor PDF — a Documents
   * add-on file can be a .docx, and a Drive-only copy is cached under it.
   */
  extension?: string;
}

/** Photos get the zoomable image reader; everything else goes to WebKit. */
function isImagePath(path: string | null): boolean {
  return path !== null && fileKindOf(path) === 'image';
}

/**
 * True when this build carries the WebView native view.
 *
 * `react-native-webview` is native code: a binary built before it was added
 * has no RNCWebView, and rendering one would crash. Probe, and fall back to
 * the share sheet's Quick Look until the app is rebuilt.
 */
export function canRenderPdf(): boolean {
  try {
    return UIManager.hasViewManagerConfig?.('RNCWebView') ?? false;
  } catch {
    return false;
  }
}

/**
 * Open the original of a document full screen, in the app: a photo in a
 * pinch-to-zoom reader, a PDF in WebKit's own PDF view (pinch, scroll pages).
 *
 * Returns `open` and the `viewer` element to render once in the screen.
 */
export function useDocumentViewer(onDelete?: (document: ViewableDocument) => void) {
  const [viewing, setViewing] = useState<ViewableDocument | null>(null);

  const open = (document: ViewableDocument) => {
    const path = resolveImageUri(document.imageUri, document.extension);
    // WebKit draws PDF, Office, text and video; without it, Quick Look does.
    if (path && !isImagePath(path) && !canRenderPdf()) void openAttachment(path);
    else setViewing(document);
  };

  const viewer = (
    <Modal
      visible={viewing !== null}
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      onRequestClose={() => setViewing(null)}
    >
      {viewing ? (
        <DocumentViewer
          document={viewing}
          onClose={() => setViewing(null)}
          onDelete={onDelete ? () => onDelete(viewing) : undefined}
        />
      ) : null}
    </Modal>
  );

  return { open, close: () => setViewing(null), viewer };
}

/** The full-screen reader for one document. */
export function DocumentViewer({
  document,
  onClose,
  onDelete,
}: {
  document: ViewableDocument;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { space } = useTheme();
  const insets = useSafeAreaInsets();
  const path = resolveImageUri(document.imageUri, document.extension);

  const roundButton = ({ pressed }: { pressed: boolean }) => ({
    opacity: pressed ? 0.6 : 1,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(0,0,0,0.55)',
  });

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
          style={roundButton}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" color="#FFFFFF" numberOfLines={1}>
            {document.title}
          </Text>
          <Text variant="caption" color="rgba(255,255,255,0.7)" numberOfLines={1}>
            {[
              document.kindLabel,
              document.documentDate.toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        {path ? (
          <Pressable
            onPress={() => void openAttachment(path)}
            accessibilityRole="button"
            accessibilityLabel={`Share or save ${document.title}`}
            hitSlop={12}
            style={roundButton}
          >
            <Ionicons name="share-outline" size={19} color="#FFFFFF" />
          </Pressable>
        ) : null}

        {onDelete ? (
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${document.title}`}
            hitSlop={12}
            style={roundButton}
          >
            <Ionicons name="trash-outline" size={19} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>

      {path && !isImagePath(path) ? (
        <PdfView uri={path} top={insets.top + space.sm + 44} />
      ) : (
      /*
        Pinch-to-zoom via a ScrollView: a photographed report is often typed at
        8pt, so reading it back means zooming, and a ScrollView with min/max
        zoom needs no gesture library.
      */
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flex: 1 }}
        maximumZoomScale={4}
        minimumZoomScale={1}
        centerContent
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        {path ? (
          <Image
            source={{ uri: path }}
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
      )}

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

/**
 * A PDF, full screen. WKWebView renders PDFs natively — every page, pinch to
 * zoom, scroll — so no PDF library is needed. Required lazily so a build
 * without the module never evaluates it (see `canRenderPdf`).
 */
function PdfView({ uri, top }: { uri: string; top: number }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview');
  return (
    <WebView
      source={{ uri }}
      /*
       * Locked to this one file. An attachment can be an .html (or a file
       * named .pdf that is not): with scripts on and read access to the whole
       * folder, it could read the user's other documents. PDFs, Office files,
       * text and video all render without JavaScript.
       */
      originWhitelist={['file://*']}
      javaScriptEnabled={false}
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowingReadAccessToURL={uri}
      // Compared decoded: WebKit may report the same path with %20 for spaces.
      onShouldStartLoadWithRequest={(request) => safeDecode(request.url) === safeDecode(uri)}
      style={{ flex: 1, marginTop: top, backgroundColor: '#000000' }}
      containerStyle={{ backgroundColor: '#000000' }}
    />
  );
}

export function safeDecode(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
