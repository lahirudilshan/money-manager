import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Intake route for incoming SMS deep links:
 *
 *   moneymanager://sms?text=<url-encoded SMS body>
 *
 * This is the target an iOS Shortcuts automation (or the share sheet) opens
 * when a bank/utility message arrives. Making it a *real* route — rather than
 * intercepting the URL in a listener — means expo-router resolves it cleanly
 * (no "Unmatched Route" 404) and the whole flow is deterministic: parse the
 * text into a draft, then redirect to the dashboard where it awaits Yes/Edit/No.
 *
 * A non-transaction message (OTP, promo, balance) parses to null and is quietly
 * dropped; the user still lands on the dashboard.
 */
export default function SmsIntakeScreen() {
  const { colors } = useTheme();
  const { text } = useLocalSearchParams<{ text?: string }>();
  const ready = useAppStore((s) => s.ready);
  const ingestSmsText = useAppStore((s) => s.ingestSmsText);

  const [done, setDone] = useState(false);
  // Ingest exactly once even though params/ready may re-render this screen.
  const handled = useRef(false);

  useEffect(() => {
    if (!ready || handled.current) return;
    handled.current = true;

    const raw = Array.isArray(text) ? text[0] : text;
    if (raw) ingestSmsText(raw);
    setDone(true);
  }, [ready, text, ingestSmsText]);

  // Once the draft is queued (or the message was ignored), land on the board.
  if (done) return <Redirect href="/(tabs)" />;

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.canvas,
      }}
    >
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}
