import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { attachmentGate } from '~/shared/lib/attachmentGate';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { BottomSheet, Button, GradientButton, Text } from './ui';

/**
 * "Keep your files in Google Drive?" — asked the first time something is
 * attached, never as a wall.
 *
 * Attaching works without it: the file is saved on the phone first, always,
 * and uploads whenever Drive is connected later. That is why "Not now" is a
 * real choice and not a dismissal trap — and why it snoozes for a week instead
 * of reappearing on the next photo.
 *
 * Used through `useDriveGate`, which returns a promise the picker awaits: the
 * prompt resolves (either way) and the picker opens straight after, so the
 * user never has to tap "attach" twice.
 */
export function useDriveGate(): {
  /** Resolve once the user has chosen, or immediately if there is nothing to ask. */
  ensureDriveChoice: () => Promise<void>;
  sheet: React.ReactNode;
} {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    setVisible(false);
    setBusy(false);
    setError(null);
    const resolve = resolver.current;
    resolver.current = null;
    // Let the sheet's dismissal animation clear before the picker presents —
    // iOS refuses to present a second controller over one still dismissing.
    setTimeout(() => resolve?.(), 450);
  }, []);

  const ensureDriveChoice = useCallback(async () => {
    let ask = false;
    try {
      ask = await attachmentGate().shouldOfferDrive();
    } catch {
      ask = false;
    }
    if (!ask) return;
    await new Promise<void>((resolve) => {
      resolver.current = resolve;
      setVisible(true);
    });
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    const result = await attachmentGate().connectDrive();
    if (result.ok) {
      attachmentGate().afterAttach();
      finish();
      return;
    }
    setBusy(false);
    // A cancelled sign-in comes back with no error — that is not a failure.
    if (result.error) setError(result.error);
  }

  function notNow() {
    attachmentGate().snoozeDrive();
    finish();
  }

  const sheet = (
    <DriveConnectSheet
      visible={visible}
      busy={busy}
      error={error}
      onConnect={connect}
      onNotNow={notNow}
    />
  );

  return { ensureDriveChoice, sheet };
}

function DriveConnectSheet({
  visible,
  busy,
  error,
  onConnect,
  onNotNow,
}: {
  visible: boolean;
  busy: boolean;
  error: string | null;
  onConnect: () => void;
  onNotNow: () => void;
}) {
  const { colors, radius, space } = useTheme();

  return (
    <BottomSheet
      visible={visible}
      onClose={onNotNow}
      icon="cloud-upload-outline"
      eyebrow="Before you attach"
      title="Keep your files safe in Google Drive"
      wrapTitle
      footer={
        <View style={{ gap: space.sm }}>
          <GradientButton
            label={busy ? 'Connecting…' : 'Continue with Google'}
            icon="logo-google"
            disabled={busy}
            onPress={onConnect}
          />
          <Button label="Not now, keep on this phone" variant="ghost" onPress={onNotNow} />
        </View>
      }
    >
      <Text variant="body" tone="secondary">
        Photos and PDFs you attach are saved on this phone first. Connect Google and they are also
        copied to your own Drive.
      </Text>

      <View style={{ gap: space.md }}>
        <Point
          icon="folder-open-outline"
          text="Saved in a money-manager folder in your Drive, where you can open them yourself."
        />
        <Point
          icon="phone-portrait-outline"
          text="Still there after a new phone or a reinstall, and visible on a paired phone."
        />
        <Point
          icon="lock-closed-outline"
          text="The app can only see files it created. The rest of your Drive stays private."
        />
      </View>

      {error ? (
        <View
          style={{
            flexDirection: 'row',
            gap: space.sm,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.dangerSoft,
          }}
        >
          <Ionicons name="alert-circle" size={18} color={colors.danger} />
          <Text variant="small" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </BottomSheet>
  );
}

function Point({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors, space } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={20} color={colors.accent} style={{ marginTop: 1 }} />
      <Text variant="body" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
