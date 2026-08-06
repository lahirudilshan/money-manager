import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet, GradientButton, Label, Row, Text } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { formatMoney } from '../../src/core/money';
import { parseSms } from '../../src/core/smsParser';
import { readClipboard } from '../../src/services/clipboard';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

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

/**
 * Manual SMS intake — the fallback that needs no automation or permissions.
 *
 * The user pastes (or types) a bank/utility alert; on "Add draft" it is parsed
 * and reconciled into the dashboard's review queue, exactly as an automated
 * deep link would be. A live preview shows what was extracted so the user sees
 * whether the message will be understood before committing it.
 */
export default function PasteSmsScreen() {
  const { colors, radius, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const ingestSmsText = useAppStore((s) => s.ingestSmsText);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  /**
   * A transaction on the clipboard is FILLED IN, not merely offered.
   *
   * Read once on open, never polled: on iOS 16+ reading the pasteboard can show
   * a system "allow paste?" banner, and a repeated prompt would be worse than
   * typing.
   *
   * Filling the box rather than showing a tap-to-accept card is the point. The
   * user copied a bank message and opened the paste screen — there is no other
   * plausible intent, and making them tap again to confirm the obvious is the
   * friction this screen exists to remove. Long-press → Paste is worse still.
   *
   * Only when it PARSES as a transaction. Dropping whatever happens to be
   * copied into the box would be startling and usually wrong, so an
   * unrecognised clipboard leaves the field empty and focused, exactly as
   * before.
   *
   * `autoFilled` drives the "we did this" banner: silently populating an input
   * the user did not type in is disorienting unless the app says so, and it is
   * what makes the one-tap Undo discoverable.
   */
  const [autoFilled, setAutoFilled] = useState(false);
  const checkedClipboard = useRef(false);

  useEffect(() => {
    if (checkedClipboard.current) return;
    checkedClipboard.current = true;

    void readClipboard().then((copied) => {
      if (!copied || !parseSms(copied)) return;

      // Never overwrite something already typed — the read is async, and the
      // user may have started before it resolved.
      setText((current) => {
        if (current.length > 0) return current;
        setAutoFilled(true);
        return copied;
      });
    });
  }, []);

  // Live preview of what the parser makes of the current text.
  const preview = text.trim() ? parseSms(text) : null;

  function onAdd() {
    const draftId = ingestSmsText(text);
    if (!draftId) {
      setError(
        "That didn't look like a transaction alert (or it's already queued). Check the text and try again.",
      );
      return;
    }
    router.replace('/(tabs)');
  }

  return (
    <BottomSheet
      visible
      asRoute
      onClose={closeModal}
      title="Paste a message"
      icon="chatbox-ellipses-outline"
      iconColor={colors.accent}
      scroll
      /*
       * Disabled until the message actually reads as a transaction.
       *
       * Tapping "Add draft" on unrecognised text previously produced an error
       * message underneath — the app knew it would fail before the tap, so
       * letting it happen and then explaining was strictly worse than not
       * offering the action.
       */
      footer={
        <GradientButton
          label="Add draft"
          icon="add"
          onPress={onAdd}
          disabled={preview === null}
        />
      }
    >
        {/*
          The RESULT leads, not the input.

          Previously the screen opened with an explanatory paragraph, then a
          green "pasted" banner, then the text box, then a second green box
          holding the parsed figures — two competing green blocks, with the one
          number the user actually wants to check ("LKR 2,500.00") reduced to a
          subtitle. Once a message is in, what matters is "did it read this
          correctly?", so that answer is now the top of the screen and the raw
          text moves below it as supporting evidence.
        */}
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
        ) : text.trim() ? (
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
              This looks like an OTP, a promotion, or a balance message. Paste the
              alert that names an amount and a shop.
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
            <Label>MESSAGE TEXT</Label>
            {text ? (
              <Pressable
                onPress={() => {
                  setText('');
                  setAutoFilled(false);
                  setError(null);
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
            value={text}
            onChangeText={(next) => {
              setText(next);
              setError(null);
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
             * Auto-filling and then raising the keyboard would cover the
             * preview above — the one thing confirming the message was
             * understood — for no benefit, since there is nothing left to type.
             */
            autoFocus={!autoFilled && !text}
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

        {error ? (
          <Text variant="caption" color={colors.danger}>
            {error}
          </Text>
        ) : null}
    </BottomSheet>
  );
}
