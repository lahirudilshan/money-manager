import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/**
 * A safe "dismiss this route modal" callback for the shared BottomSheet.
 *
 * Route modals normally close with `router.back()`, but a modal can be the very
 * first screen in the stack — opened straight from a deep link (e.g. the SMS
 * Shortcut's `moneymanager://sms/…`) or a cold launch — in which case there is
 * nothing to pop and `back()` logs "The action 'GO_BACK' was not handled by any
 * navigator." This falls back to replacing with the dashboard so closing always
 * lands somewhere sensible.
 */
export function useModalClose(): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [router]);
}
