# SMS → transaction intake

Money Manager reads bank / utility SMS alerts, extracts the amount, payee and
date, and drops a **draft transaction** on the dashboard for you to confirm with
**Yes / Edit / No**. Nothing is ever logged silently — you always get the last
word.

## Why it works this way (iOS reality)

**iOS gives no app permission to read your SMS inbox.** There is no API for it —
not for this app, not for any App Store app. So instead of the app *pulling*
messages, the message is *pushed into* the app as a link:

```
moneymanager://sms?text=<the SMS text, URL-encoded>
```

Anything that can open that link creates a draft. There are three ways to feed
it, from most to least automatic:

| Path | How automatic | Setup |
|------|---------------|-------|
| **iOS Shortcuts automation** | Near-automatic — fires when a matching SMS arrives | One-time, below |
| **Share sheet** *(optional future)* | One tap on a message | — |
| **Paste** | Manual: Dashboard → **Paste SMS** | None |

The parser, the draft queue and the confirm UI are identical for all three, so
start with **Paste** to try it today, then add the Shortcut for hands-off use.

## Set up the iOS Shortcuts automation (near-automatic)

Do this once on the iPhone. It watches for incoming texts that look like bank /
utility alerts and opens a draft for each.

1. Open the **Shortcuts** app → **Automation** tab → **+** → **Create Personal
   Automation**.
2. Choose **Message**.
   - **Message Contains** → add the words your alerts always include. Good
     starters for Sri Lankan banks/utilities:
     `debited`, `credited`, `withdrawal`, `Rs.`, `LKR`, `CEB`, `NWSDB`.
     (You can create several automations, one per keyword, or use one with the
     most common word like `Rs.`.)
   - **Foreign-currency alerts** (an inward SWIFT salary, a card used abroad)
     do not contain `LKR`, so they need their own automation on the code the
     bank prints — usually `USD`. The parser reads any ISO code it recognises
     and the app converts the amount to your currency using the USD rate saved
     in Settings, keeping the original figure on the draft for reference.
   - Set it to **Run Immediately** (not "Run After Confirmation") so it's
     hands-off. iOS may still show a brief banner.
3. Tap **Next** → **New Blank Automation** → **Add Action**.
4. Add **URL** action. Set the URL to:
   ```
   moneymanager://sms?text=
   ```
5. Add a **Text** action *(optional but tidy)* — actually simpler: use
   **Get Contents of URL** is *not* needed. Instead build the URL with the
   message:
   - Add action **URL Encode** → input: the **Shortcut Input** (the message
     text). This is the magic variable that holds the SMS body.
   - Add action **Text** → value: `moneymanager://sms?text=` followed by the
     **URL Encoded Text** variable from the previous step.
   - Add action **Open URLs** → input: that **Text**.
6. **Done.**

Now when a matching SMS arrives, the Shortcut opens Money Manager, which parses
the message and shows a draft under **FROM YOUR MESSAGES** on the dashboard.

> **Note:** iOS message automations only fire for **SMS** you actually receive,
> and Apple sometimes requires the phone unlocked. RCS/iMessage bank alerts are
> rarer but the same keywords apply. If a bank sends from a saved contact, the
> automation still sees it (unlike the spam-filter API, which cannot).

## The message samples file

The parser is driven and tested against [`src/data/sms-samples.json`](../src/data/sms-samples.json).
Each entry is one real-world alert shape with the fields the parser must pull
out (or `expect: null` for messages to ignore, like OTPs).

**To teach the parser your real bank's format:**

1. Replace a sample's `raw` with a real message (redact digits with `X` if you
   like), and update its `expect` to the correct values.
2. Add new entries for formats not yet covered.
3. Run `yarn test src/core/__tests__/smsParser.test.ts`. Any mismatch fails
   loudly and names the sample, so you know exactly what to adjust in
   [`src/core/smsParser.ts`](../src/core/smsParser.ts).

## How a draft maps onto the board

This app is a **funding board**, not a ledger — a spend is recorded as *"this
bill got paid this month."* So a parsed SMS is matched to one of your budget
lines (subcategories):

- **Debit / bill** messages match **expense** lines; **credit** messages match
  **income** lines.
- Matching uses the merchant text, the amount (within ±15 %), and the account's
  last-4 vs. the card. The best guess is pre-selected when confident; otherwise
  the draft opens in edit mode and you pick the line.
- Confirming logs it against that line for the current month via the same
  `logTransaction` path the manual "+" uses, with the SMS kept as the note.

Reconciliation lives in [`src/core/smsReconcile.ts`](../src/core/smsReconcile.ts);
the confirm card is [`src/components/SmsDraftCard.tsx`](../src/components/SmsDraftCard.tsx).
