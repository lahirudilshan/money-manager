import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Field } from '../../src/components/forms';
import { BottomSheet, GradientButton, T } from '../../src/components/ui';
import { useModalClose } from '../../src/hooks/useModalClose';
import { formatMoney } from '../../src/core/money';
import { parseSms } from '../../src/core/smsParser';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '../../src/theme/ThemeProvider';

/**
 * Manual SMS intake — the fallback that needs no automation or permissions.
 *
 * The user pastes (or types) a bank/utility alert; on "Add draft" it is parsed
 * and reconciled into the dashboard's review queue, exactly as an automated
 * deep link would be. A live preview shows what was extracted so the user sees
 * whether the message will be understood before committing it.
 */
export default function PasteSmsScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const ingestSmsText = useAppStore((s) => s.ingestSmsText);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      onClose={closeModal}
      title="Paste a message"
      icon="chatbox-ellipses-outline"
      iconColor={colors.accent}
      heightPct={0.85}
      scroll
      footer={<GradientButton label="Add draft" icon="add" onPress={onAdd} />}
    >
        <T variant="small" tone="muted">
          Paste a bank or utility SMS. We read the amount, who it was for, and the date, then add a
          draft you confirm on the dashboard.
        </T>

        <View style={{ gap: space.sm }}>
          <Field
            label="Message text"
            value={text}
            onChangeText={(next) => {
              setText(next);
              setError(null);
            }}
            placeholder="e.g. Your Card ending 1234 was debited LKR 12,500.00 at KEELLS SUPER on 24/07/2026."
            multiline
            autoFocus
          />
        </View>

        {preview ? (
          <View
            style={{
              gap: 4,
              padding: space.md,
              borderRadius: 12,
              backgroundColor: colors.completedSoft,
              borderWidth: 1,
              borderColor: colors.completed,
            }}
          >
            <T variant="caption" color={colors.completed} style={{ fontWeight: '800' }}>
              WILL BE READ AS
            </T>
            <T variant="bodyStrong">
              {preview.direction === 'credit'
                ? 'Money in'
                : preview.direction === 'bill'
                  ? 'Bill due'
                  : 'Paid out'}{' '}
              · {formatMoney(preview.amountMinor, { showDecimals: true })}
            </T>
            {preview.merchant ? (
              <T variant="caption" tone="secondary">
                {preview.merchant}
                {preview.date ? ` · ${preview.date}` : ''}
              </T>
            ) : null}
          </View>
        ) : text.trim() ? (
          <T variant="caption" color={colors.pending}>
            Not recognised as a transaction yet — it may be an OTP, promo, or balance message.
          </T>
        ) : null}

        {error ? (
          <T variant="caption" color={colors.danger}>
            {error}
          </T>
        ) : null}
    </BottomSheet>
  );
}
