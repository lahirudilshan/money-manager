import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { BottomSheet, GradientButton, Text } from '~/shared/components/ui';
import { MessagePasteField } from '~/features/sms/components/MessagePasteField';
import { useModalClose } from '~/shared/hooks/useModalClose';
import type { ParsedSms } from '~/features/sms/logic/smsParser';
import { useAppStore } from '../../src/store/useAppStore';
import { useTheme } from '~/shared/theme/ThemeProvider';

/**
 * Manual SMS intake — the fallback that needs no automation or permissions.
 *
 * The user pastes (or types) a bank/utility alert; on "Add draft" it is parsed
 * and reconciled into the dashboard's review queue, exactly as an automated
 * deep link would be.
 *
 * The paste box, the live parse preview and the clipboard behaviour all live in
 * `MessagePasteField`, which the "add entry" screen mounts too — so a user who
 * already has the message copied can use it there without backing out of the
 * form they are in. This screen is now just that control plus the action that
 * commits it.
 */
export default function PasteSmsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const closeModal = useModalClose();
  const ingestSmsText = useAppStore((s) => s.ingestSmsText);

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedSms | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        <GradientButton label="Add draft" icon="add" onPress={onAdd} disabled={parsed === null} />
      }
    >
      <MessagePasteField
        value={text}
        onChangeText={(next) => {
          setText(next);
          setError(null);
        }}
        onParsed={setParsed}
      />

      {error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
