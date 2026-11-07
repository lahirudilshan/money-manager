# SMS → transaction intake (Smart Detect)

Dayly reads bank and utility SMS alerts. It pulls out the amount, payee, account
and date, and adds a **draft transaction** for you to confirm. Nothing is ever
logged silently: you always have the last word.

## Why it works this way (iOS reality)

**iOS gives no app permission to read your SMS inbox.** No App Store app has
that API. So the app never *pulls* messages. A Shortcuts automation *hands*
each alert to the app.

| Intake | How automatic | Setup |
|--------|---------------|-------|
| **Shortcuts automation → "Send Message to Dayly"** | Automatic: runs in the background for every matching SMS | One time, below |
| **Paste** | Manual: Add transaction → **Paste message**, or Dashboard → Paste SMS | None |

The parser, draft queue and confirm screen are the same for both.

## Set up the automation (one tap)

Dayly adds its own action to the Shortcuts app, **Send Message to Dayly**.
A ready-made shortcut, **Dayly App Automation**, holds the Message trigger
and that action:

**https://www.icloud.com/shortcuts/d95ccb33eadc41988a6b2fab7ca16a42**

Open that link on the iPhone, or tap **Add shortcut** in Dayly (**Settings →
Auto-detect transactions**). The Shortcuts app opens; follow its on-screen
steps to add it.

Then run it **once by hand**: on the **Dayly App Automation** tile, tap the
play button and choose **Allow**. An added automation asks for permission the
first time it runs, and it can't ask when a message triggers it, so without
this step it never runs. The in-app setup card shows the tile with the button
highlighted (`assets/images/shortcut-run-once.png`).

To test, tap **Send test alert** in the same screen and send it to your own
number. A draft for *LKR 1,250.00 at KEELLS SUPER (TEST)* appears within
seconds. Each test alert is stamped with its minute, so a repeat test is never
swallowed as a duplicate.

The trigger has no keyword, because no single word catches every bank. On the
author's phone, `LKR` caught 141 of 146 real transactions; it missed USD
salary/interest alerts and a CEB receipt written "Rs.". The action filters
instead: a text with no digit, or with neither a currency, `Rs`, a currency
symbol nor a money word, is dropped before it is written anywhere
(`DaylyMoneySignal` in the Swift file). Checked against the real corpus: 146/146
transactions kept, while chats and OTPs are dropped. Promos that mention a price
get through, and the app's classifier rejects them.

To change the shared shortcut, edit it in Shortcuts, share a new iCloud link,
and put it in the catalog database. **No app release is needed:**

```sql
UPDATE app_config SET value = 'https://www.icloud.com/shortcuts/<id>', updated_at = now()
 WHERE key = 'sms_shortcut_url';
```

The app reads it from `GET /api/config` each time the setup screen opens and
caches it. The server caches it for about a minute. The app only accepts an
`https://www.icloud.com/shortcuts/<32 hex>` link and otherwise keeps its last
good one. Also update `DEFAULT_SHORTCUT_URL` in
`src/features/sms/logic/shortcutLink.ts` at the next release: it is only used
on an install that has never reached the server.

Before publishing a link, check that its action targets the current bundle id
(see the `rename-app` skill).

### Moving from the old setup

Earlier versions taught two other automations. Both still work, so nothing
breaks, but they are no longer documented:

- **Open URLs** with `moneymanager://sms?text=<URL-encoded message>`. It
  opens the app every time, and a missed **URL Encode** step cuts the message at
  its first space.
- **Append to Text File** into `temp-sms-inbox.txt`, with each message wrapped
  in `{…}`. A reinstall leaves the Shortcut writing to the old app folder.

To upgrade, delete the old automation and add **Dayly App Automation** using
the steps above.

## How the action reaches the app

```
Message arrives ─► Shortcuts automation ─► Send Message to Dayly (App Intent, background)
                                              │ writes one file per message
                                              ▼
                              Documents/.sms-intake/<epoch-ms>-<uuid>.txt
                                              │ read on launch, on foreground,
                                              │ and every 2 s while open
                                              ▼
                     drainInbox → parser → sms_inbox table → draft on the dashboard
```

- **Money pre-filter:** `DaylyMoneySignal` in the Swift file. It is lenient
  on purpose, because a false negative loses a transaction while a false
  positive costs nothing.
- **Native side:** [`plugins/ios/SendMessageToDaylyIntent.swift`](../plugins/ios/SendMessageToDaylyIntent.swift).
  It is an `AppIntent` with `openAppWhenRun = false`, and an `AppShortcutsProvider`
  lists it under Dayly. The config plugin
  [`plugins/withSmsAppIntent.js`](../plugins/withSmsAppIntent.js) copies it into
  the app target on every `expo prebuild`. **A native rebuild is needed** before
  the action shows up in Shortcuts.
- **One atomic file per message.** Nothing is appended to a shared file, so the
  app's drain can never race the automation. One file is one message, so there
  is no separator to get wrong. The leading dot hides the folder from the Files
  app.
- **JS side:** [`smsIntentQueue.ts`](../src/features/sms/logic/smsIntentQueue.ts)
  reads the folder. [`drainInbox`](../src/features/sms/logic/smsInboxFile.ts)
  feeds those messages, then any legacy file messages, through the store's
  commit. A queue file is deleted only **after** its message is stored, so a
  crash replays the message instead of losing it. The `sms_inbox.fingerprint`
  unique index absorbs the repeat.
- A message the parser can't read is parked in `temp-sms-inbox.txt`, like
  every other leftover. That file is the corpus of parser gaps you can pull
  off the device.

## The message samples file

The parser is tested against
[`src/features/sms/logic/sms-samples.json`](../src/features/sms/logic/sms-samples.json).
Each entry is one real alert shape. It lists the fields the parser must pull
out, or uses `expect: null` for messages to ignore, such as OTPs.

To teach the parser a new bank format:

1. Add the real message as `raw` (redact digits with `X` if you like), plus
   the correct `expect`.
2. Run `yarn test src/features/sms/logic/__tests__/smsParser.test.ts`. A
   mismatch fails loudly and names the sample.

## How a draft maps onto the board

A parsed SMS is matched to one of your budget lines:

- Debit and bill messages match **expense** lines. Credit messages match
  **income** lines.
- Matching uses the learned merchant rules, the category hint, the amount and
  the account's last digits.
- A confident match offers a one-tap **Yes, that's right**. Otherwise you pick
  the line.
- Confirming logs the payment through the same path as a manual entry. An
  "Avl Bal" in the message also anchors that account's balance.

Reconciliation lives in
[`smsReconcile.ts`](../src/features/sms/logic/smsReconcile.ts). The draft
card is [`SmsDraftCard.tsx`](../src/features/sms/components/SmsDraftCard.tsx).
