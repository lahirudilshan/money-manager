import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AskScreen } from '~/features/ask/components/AskScreen';
import type { AskScope } from '~/features/ask/logic/askScope';

const SCOPES: readonly AskScope[] = ['global', 'health', 'money', 'life'];

/** Ask AI from anywhere — opened by the floating button with the screen's scope. */
export default function AskRoute() {
  const params = useLocalSearchParams<{ scope?: string; person?: string; q?: string }>();
  const scope = SCOPES.includes(params.scope as AskScope) ? (params.scope as AskScope) : 'global';
  return (
    // Keyed by scope: opening Ask AI again from another section may reuse this
    // route, and the chat, consent and starters must start fresh for the new one.
    <AskScreen
      key={`${scope}:${params.person ?? ''}`}
      scope={scope}
      personId={params.person}
      initialQuestion={params.q ? decodeURIComponent(params.q) : undefined}
    />
  );
}
