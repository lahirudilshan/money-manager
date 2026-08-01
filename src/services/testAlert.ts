import { Linking } from 'react-native';

/**
 * Open the Messages app with a dummy bank alert already typed.
 *
 * This is how the user tests the whole chain: they send the message to
 * themselves, their Shortcuts automation catches it, appends it to the inbox
 * file, and the app imports it. Every link is exercised, which is the only way
 * to find out whether the automation is actually wired correctly — writing to
 * the file directly from the app would prove nothing about Shortcuts.
 *
 * iOS gives no way to send an SMS from an app, and no way to read the user's own
 * number, so the recipient is left for them to pick. That is a deliberate
 * platform limit, not a gap: an app that could silently text you would be a
 * problem.
 *
 * The body is chosen to be unmistakably fake — a round amount at a well-known
 * chain — so nobody mistakes the test draft for a real transaction, while still
 * containing everything the parser needs: currency code, amount, and a merchant.
 */

/** The dummy alert. Contains "LKR" so the usual automation filter catches it. */
export const TEST_ALERT_BODY =
  'LKR 1,250.00 debited from AC XXXXXXXX0000 as POS TXN at KEELLS SUPER. Avl Bal 99,999.00';

/**
 * Open Messages with the test alert pre-filled.
 *
 * Resolves false when the sheet could not be opened — a simulator with no
 * Messages app, or a platform that refuses the scheme — so the caller can say
 * so rather than leaving the user waiting for an app that never appears.
 */
export async function openTestAlertComposer(): Promise<boolean> {
  // `sms:&body=` with no recipient opens the composer with the To field empty
  // and the cursor ready, which is what we want: the user picks themselves.
  // The `&` before `body` is required on iOS even with no address before it.
  const url = `sms:&body=${encodeURIComponent(TEST_ALERT_BODY)}`;

  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;

    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
