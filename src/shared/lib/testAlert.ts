import { Linking } from 'react-native';

/**
 * Open the Messages app with a dummy bank alert already typed.
 *
 * This is how the user tests the whole chain: they send the message to
 * themselves, their Shortcuts automation catches it and runs "Send Message to
 * Dayly", and the app imports it. Every link is exercised, which is the only
 * way to find out whether the automation is actually wired correctly —
 * queueing the message from inside the app would prove nothing about Shortcuts.
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

/**
 * The dummy alert. Contains "LKR" so the usual automation filter catches it.
 *
 * Names one of the user's OWN accounts when there is one: "Ignore other
 * people's accounts" drops an alert for an account the board does not have,
 * so a test on a made-up number looked exactly like a broken automation. No
 * "Avl Bal" — on a real account that figure would be taken as the bank's
 * balance and move it.
 */
export function testAlertBody(accountLast4?: string | null, now: Date = new Date()): string {
  const digits = accountLast4 && /^\d{4}$/.test(accountLast4) ? accountLast4 : '0000';
  /*
   * Stamped with the minute it was made. A fixed text is one message as far as
   * the duplicate guard is concerned, so every test after the first was
   * dropped as "already imported" — a working setup that looked broken.
   */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${pad(now.getDate())} ${MONTHS[now.getMonth()]} ${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `LKR 1,250.00 debited from AC XXXXXXXX${digits} on ${when} as POS TXN at KEELLS SUPER (TEST).`;
}

/**
 * Open Messages with the test alert pre-filled.
 *
 * Resolves false when the sheet could not be opened — a simulator with no
 * Messages app, or a platform that refuses the scheme — so the caller can say
 * so rather than leaving the user waiting for an app that never appears.
 */
export async function openTestAlertComposer(
  accountLast4?: string | null,
  recipient?: string | null,
): Promise<boolean> {
  // `sms:<number>&body=` fills both fields, so the user only taps Send. With no
  // number the To field is left empty for them to pick themselves. The `&`
  // before `body` is required on iOS either way.
  const to = recipient ? cleanPhoneNumber(recipient) ?? '' : '';
  const url = `sms:${to}&body=${encodeURIComponent(testAlertBody(accountLast4))}`;

  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;

    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * A typed phone number reduced to what an `sms:` link accepts: digits with an
 * optional leading "+". Null when it cannot be a phone number.
 */
export function cleanPhoneNumber(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}
