import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { parseSms, type ParsedSms } from '~/features/sms/logic/smsParser';
import { readClipboard } from '~/shared/lib/clipboard';
import { formatMoney } from '~/shared/lib/money';
import { Label, Row, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Paste a bank message and see what the app makes of it — the one control,
 * used everywhere a message can be turned into a transaction.
 *
 * ## Why this is a component and not two screens
 *
 * This flow existed twice: the dedicated "Paste a message" screen, and nothing
 * at all on the manual "add entry" screen, which meant a user with the SMS in
 * their clipboard had to back out of the form they were already in, find the
 * other door, and start again. Now both mount this, so the parse feedback, the
 * clipboard behaviour and the wording cannot drift apart, and pasting is
 * available at the moment the user actually has the message to hand.
 *
 * ## The result leads, the input follows
 *
 * The layout puts the VERDICT above the text box. Once a message is in, the
 * question is no longer "what do I type" but "did it read this correctly?", and
 * the amount is the figure being checked — so it is the largest thing on
 * screen, not a subtitle under a wall of raw SMS text.
 *
 * ## The clipboard is filled in, not offered
 *
 * A transaction on the clipboard is dropped straight into the box. The user
 * copied a bank message and opened a paste control; there is no other plausible
 * intent, and a tap-to-accept card would be friction for the exact case this
 * exists to serve. Read ONCE per mount, never polled — on iOS 16+ each read can
 * raise a system "allow paste?" banner, and a repeated prompt is worse than
 * typing. Only when it actually parses, so an unrelated clipboard leaves the
 * field empty rather than dropping a shopping list into a form.
 */
export function MessagePasteField({
  value,
  onChangeText,
  /**
   * Called whenever the parse result changes, so the host can enable its own
   * save button without re-parsing the same text a second time.
   */
  onParsed,
  /** Set false on a host that should not touch the pasteboard on mount. */
  autoFillFromClipboard = true,
  autoFocus = true,
  label = 'MESSAGE TEXT',
}: {
  value: string;
  onChangeText: (next: string) => void;
  onParsed?: (parsed: ParsedSms | null) => void;
  autoFillFromClipboard?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const { colors, radius, space } = useTheme();

  /**
   * Drives the "we did this" note.
   *
   * Silently populating an input the user did not type in is disorienting
   * unless the app says so, and saying so is what makes Clear discoverable.
   */
  const [autoFilled, setAutoFilled] = useState(false);
  const checkedClipboard = useRef(false);

  useEffect(() => {
    if (!autoFillFromClipboard || checkedClipboard.current) return;
    checkedClipboard.current = true;

    void readClipboard().then((copied) => {
      if (!copied || !parseSms(copied)) return;
      // Never overwrite something already typed — the read is async, and the
      // user may have started before it resolved.
      if (value.length > 0) return;
      setAutoFilled(true);
      onChangeText(copied);
    });
    // Mount-only by design; `checkedClipboard` is the real guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFillFromClipboard]);

  /*
   * Memoised on the TEXT, not recomputed every render.
   *
   * `parseSms` is pure and cheap, so calling it per render was harmless in
   * itself — but it returns a fresh object each time, and that object was an
   * effect dependency below. Reporting it called back into the host, the host
   * set state, the re-render produced another new object, and the effect fired
   * again: "Maximum update depth exceeded" on the paste screen, forever.
   *
   * Keying the memo on `value` means the identity changes only when the text
   * does, which is the thing the effect is actually about.
   */
  const preview = useMemo(() => (value.trim() ? parseSms(value) : null), [value]);

  /*
   * Reported to the host on every change of RESULT, not on every keystroke.
   *
   * Guarded on the parsed OUTCOME rather than object identity: two different
   * keystrokes ("LKR 100 " and "LKR 100") routinely parse to the same
   * transaction, and re-reporting it would re-render the host for nothing.
   * A cheap signature compares what the host actually consumes.
   */
  const signature = preview
    ? `${preview.direction}|${preview.kind}|${preview.amountMinor}|${preview.currency ?? ''}|${preview.merchant}|${preview.account}|${preview.date ?? ''}`
    : null;

  const lastReported = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastReported.current === signature) return;
    lastReported.current = signature;
    onParsed?.(preview);
    // `preview` is derived from `signature`; depending on it as well would
    // re-introduce the identity churn this exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, onParsed]);

  return (
    <View style={{ gap: space.md }}>
      {preview ? (
        <View
          style={{
            gap: space.md,
            padding: space.lg,
            borderRadius: radius.lg,
            backgroundColor: colors.completedSoft,
          }}
        >
          <Row gap={6}>
            <Ionicons name="checkmark-circle" size={15} color={colors.completed} />
            <Text
              variant="caption"
              color={colors.completed}
              style={{ fontWeight: '800', letterSpacing: 0.4 }}
            >
              READ SUCCESSFULLY
            </Text>
            {autoFilled ? (
              <>
                <Text variant="caption" color={colors.completed}>
                  ·
                </Text>
                <Text variant="caption" color={colors.completed}>
                  from clipboard
                </Text>
              </>
            ) : null}
          </Row>

          {/* The amount as the hero — it is the figure being checked. */}
          <View style={{ gap: 2 }}>
            <Text variant="display" color={colors.completed}>
              {formatMoney(preview.amountMinor, { showDecimals: true })}
            </Text>
            <Text variant="small" tone="secondary">
              {preview.direction === 'credit'
                ? 'Money in'
                : preview.direction === 'bill'
                  ? 'Bill due'
                  : 'Paid out'}
              {preview.merchant ? ` · ${preview.merchant}` : ''}
            </Text>
          </View>

          {preview.date || preview.account ? (
            <Row gap={space.md}>
              {preview.date ? <Detail icon="calendar-outline" value={preview.date} /> : null}
              {preview.account ? (
                <Detail icon="card-outline" value={`••${preview.account}`} />
              ) : null}
            </Row>
          ) : null}
        </View>
      ) : value.trim() ? (
        /* Not recognised — amber, and specific about the likely reason. */
        <View
          style={{
            gap: 4,
            padding: space.lg,
            borderRadius: radius.lg,
            backgroundColor: colors.pendingSoft,
          }}
        >
          <Row gap={6}>
            <Ionicons name="alert-circle" size={15} color={colors.pending} />
            <Text variant="caption" color={colors.pending} style={{ fontWeight: '800' }}>
              NOT A TRANSACTION
            </Text>
          </Row>
          <Text variant="small" tone="secondary">
            This looks like an OTP, a promotion, or a balance message. Paste the alert that
            names an amount and a shop.
          </Text>
        </View>
      ) : (
        /* Nothing yet — one line of instruction, not a paragraph. */
        <Row gap={space.sm}>
          <Ionicons name="clipboard-outline" size={17} color={colors.inkMuted} />
          <Text variant="small" tone="muted" style={{ flex: 1 }}>
            Copy a bank SMS and it appears here automatically — or paste it below.
          </Text>
        </Row>
      )}

      <View style={{ gap: space.sm }}>
        <Row justify="space-between">
          <Label>{label}</Label>
          {value ? (
            <Pressable
              onPress={() => {
                onChangeText('');
                setAutoFilled(false);
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear the message"
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text variant="caption" color={colors.accent} style={{ fontWeight: '700' }}>
                Clear
              </Text>
            </Pressable>
          ) : null}
        </Row>

        <TextInput
          value={value}
          onChangeText={(next) => {
            onChangeText(next);
            // Once edited it is the user's text, not ours — the "from
            // clipboard" note would be claiming credit for their typing.
            setAutoFilled(false);
          }}
          placeholder="Your Card ending 1234 was debited LKR 12,500.00 at KEELLS SUPER on 24/07/2026."
          placeholderTextColor={colors.inkMuted}
          multiline
          /*
           * Focus only when the box is EMPTY.
           *
           * Auto-filling and then raising the keyboard would cover the preview
           * above — the one thing confirming the message was understood — for
           * no benefit, since there is nothing left to type.
           */
          autoFocus={autoFocus && !autoFilled && !value}
          accessibilityLabel="Message text"
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.hairline,
            paddingHorizontal: space.md,
            paddingVertical: 13,
            minHeight: 96,
            fontSize: 15,
            lineHeight: 21,
            letterSpacing: 0,
            color: colors.ink,
            textAlignVertical: 'top',
          }}
        />
      </View>
    </View>
  );
}

/**
 * One extracted field — an icon and its value, sized to sit beside others.
 *
 * The date and account are supporting detail, not the headline, so they read as
 * a quiet row under the amount rather than as separate labelled lines.
 */
function Detail({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  const { colors } = useTheme();

  return (
    <Row gap={5}>
      <Ionicons name={icon} size={13} color={colors.inkMuted} />
      <Text variant="caption" tone="muted">
        {value}
      </Text>
    </Row>
  );
}
