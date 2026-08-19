import { Redirect, useGlobalSearchParams, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { extractSmsFromUrl, decodeSmsParam, looksTruncated } from '~/features/sms/logic/smsIntakeUrl';
import { logSmsIntake } from '~/features/sms/logic/smsIntakeLog';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Intake route for incoming SMS deep links:
 *
 *   moneymanager://sms?text=<SMS body>
 *
 * This is the target an iOS Shortcuts automation (or the share sheet) opens
 * when a bank/utility message arrives. Making it a *real* route — rather than
 * intercepting the URL in a listener — means expo-router resolves it cleanly
 * (no "Unmatched Route" 404) and the whole flow is deterministic: parse the
 * text into a draft, then redirect to the dashboard where it awaits Yes/Edit/No.
 *
 * Getting the text back is deliberately defensive. expo-router's param already
 * percent-decodes, but real Shortcuts deliver every shape imaginable — not
 * encoded at all, encoded twice, or truncated at an "&" in the message — so the
 * raw URL is re-read from `Linking` and normalised (see core/smsIntakeUrl.ts)
 * whenever the router's own param looks lossy. A non-transaction message (OTP,
 * promo, balance) parses to null and is quietly dropped; the user still lands on
 * the dashboard.
 */
export default function SmsIntakeScreen() {
  const { colors } = useTheme();
  const { text } = useLocalSearchParams<{ text?: string }>();
  // Global params survive cases where the route matched but the local param
  // did not populate (an unencoded URL can shift how the path is segmented).
  const globalParams = useGlobalSearchParams<{ text?: string }>();
  const ready = useAppStore((s) => s.ready);
  const ingestSmsText = useAppStore((s) => s.ingestSmsText);

  const [done, setDone] = useState(false);
  // Ingest exactly once even though params/ready may re-render this screen.
  const handled = useRef(false);

  useEffect(() => {
    // Wait for the store rather than dropping the message: this effect re-runs
    // when `ready` flips, and `handled` keeps the ingest to exactly once.
    if (!ready || handled.current) return;
    handled.current = true;

    const fromParam = firstValue(text) ?? firstValue(globalParams.text);

    // The router's param is the happy path; the raw URL is the fallback that
    // survives an un-encoded or "&"-containing message, which the param
    // would have truncated. Whichever is longer is the more complete message.
    void Linking.getInitialURL()
      .then((url) => {
        const fromUrl = url ? extractSmsFromUrl(url) : null;
        const decodedParam = fromParam ? decodeSmsParam(fromParam) : null;

        const best =
          fromUrl && (!decodedParam || fromUrl.length > decodedParam.length)
            ? fromUrl
            : decodedParam;

        if (best) {
          const id = ingestSmsText(best);
          // Same diagnostics as the root layout's listener, so a cold start
          // that silently drops a message is as visible as a warm one.
          logSmsIntake(
            id === 'duplicate'
              ? 'duplicate'
              : id
                ? 'ingested'
                : looksTruncated(best)
                  ? 'truncated'
                  : 'parser-rejected',
            best,
          );
        } else {
          logSmsIntake('no-text-param', url ?? '(no launch URL)');
        }

        // Deliberately NOT calling `Linking.clearInitialURL()` here: the root
        // layout reads the same launch URL for the cold-start case, and whoever
        // ran first would blank it for the other. The store's raw-text dedupe
        // already stops the two paths from queueing the message twice.
      })
      .catch(() => {
        // A failed URL read must never strand the user on a spinner.
        if (!fromParam) return;
        const fallback = decodeSmsParam(fromParam);
        const id = ingestSmsText(fallback);
        // Logged like every other path: this branch previously ingested
        // silently, so a message lost here left no trace in the diagnostics
        // panel — the one place the user can see what happened.
        logSmsIntake(
          id === 'duplicate'
            ? 'duplicate'
            : id
              ? 'ingested'
              : looksTruncated(fallback)
                ? 'truncated'
                : 'parser-rejected',
          fallback,
        );
      })
      .finally(() => setDone(true));
  }, [ready, text, globalParams.text, ingestSmsText]);

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

/** Router params are `string | string[]`; take the first meaningful value. */
function firstValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}
