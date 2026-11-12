import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { BottomSheet, Text } from '~/shared/components/ui';
import { useTheme } from '~/shared/theme/ThemeProvider';
import { TermsContent } from '~/features/terms/components/TermsContent';
import { termsAcceptedAt } from '~/features/terms/components/termsStore';

/** The terms the user agreed to, to read again. */
export default function TermsSheet() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const at = termsAcceptedAt();

  return (
    <BottomSheet
      visible
      asRoute
      onClose={() => router.back()}
      title="Terms & privacy"
      icon="document-text-outline"
      iconColor={colors.accent}
      scroll
    >
      <View style={{ gap: space.lg }}>
        <TermsContent />
        {at ? (
          <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            {`You agreed on ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}
