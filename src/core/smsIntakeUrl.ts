/**
 * Recover the SMS body from whatever the iOS Shortcut actually delivered.
 *
 * The documented setup asks the user to add a "URL Encode" action before
 * building `moneymanager://sms?text=…`. That step is the single most fragile
 * part of the automation, and getting it wrong fails in ways that look like
 * "the app just doesn't open":
 *
 *   - skipping URL Encode leaves raw spaces in the URL, which iOS refuses to
 *     open at all, so `Open URLs` silently does nothing;
 *   - inserting the *unencoded* "Shortcut Input" chip after an encoded prefix
 *     produces a half-encoded URL;
 *   - encoding twice (URL Encode applied to an already-encoded variable)
 *     delivers "%2520" sequences that decode to literal "%20" text, so the
 *     parser sees no spaces and matches nothing;
 *   - a message containing "&" or "#" truncates the query at that character.
 *
 * Rather than demand a perfect Shortcut, this normalises every one of those
 * shapes back to the original message. It is a pure string function so each
 * case is covered by a test.
 */

/** Percent-decode, tolerating text that is not validly encoded at all. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray "%" (common in real SMS: "5% interest") makes decodeURIComponent
    // throw. The text is then almost certainly not encoded, so use it as-is.
    return value;
  }
}

/**
 * True when a string still looks percent-encoded — used to unwrap the
 * double-encoded case, where one decode pass yields "%20"-riddled text rather
 * than readable words.
 */
function looksEncoded(value: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(value);
}

/** Undo up to two rounds of percent-encoding, plus "+" as space. */
export function decodeSmsParam(raw: string): string {
  let text = safeDecode(raw);

  // A second pass only when the first left encoding behind — that is the
  // signature of a Shortcut that ran URL Encode over an already-encoded value.
  if (looksEncoded(text)) {
    const second = safeDecode(text);
    // Guard against a message that legitimately contains a "%NN" sequence:
    // only accept the extra pass if it actually changed something.
    if (second !== text) text = second;
  }

  // Some Shortcut/webhook paths form-encode, where "+" means a space. Only
  // applied when the text has no spaces already, so a genuine "A + B" survives.
  if (!text.includes(' ') && text.includes('+')) {
    text = text.replace(/\+/g, ' ');
  }

  return text.trim();
}

/**
 * Pull the message out of a full deep-link URL.
 *
 * Deliberately not using `URL`/`URLSearchParams`: an unencoded SMS body can
 * contain "&" and "#", which those APIs treat as query/fragment delimiters and
 * would truncate the message at. Everything after the first `text=` is the
 * message, so it is taken verbatim and then decoded.
 *
 * Returns null when the URL carries no `text` parameter.
 */
export function extractSmsFromUrl(url: string): string | null {
  if (!url) return null;

  const marker = url.match(/[?&]text=/);
  if (marker?.index === undefined) return null;

  const body = url.slice(marker.index + marker[0].length);
  const decoded = decodeSmsParam(body);
  return decoded.length > 0 ? decoded : null;
}
