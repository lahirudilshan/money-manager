import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A frosted-glass backdrop: expo-blur's BlurView when the native module is in
 * this binary, nothing at all when it is not. (On Android BlurView is a
 * translucent tint rather than a true blur.)
 *
 * expo-blur was added after earlier dev builds were made. Its entry point
 * resolves the native view at import time, and a missing native module does not
 * reliably land in a try/catch around `require` (see googleDrive.ts). So this
 * asks the native registry first. On an old binary the caller's own solid
 * background shows through, exactly as before the blur existed.
 */
type BlurViewType = React.ComponentType<{
  intensity?: number;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}>;

let blurView: BlurViewType | null | undefined;

function loadBlurView(): BlurViewType | null {
  if (blurView !== undefined) return blurView;
  try {
    const registry = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
    if (!registry || !registry.ExpoBlur) {
      blurView = null;
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    blurView = (require('expo-blur') as { BlurView: BlurViewType }).BlurView;
  } catch {
    blurView = null;
  }
  return blurView;
}

/** True when this binary can blur. */
export function canBlur(): boolean {
  return loadBlurView() !== null;
}

export function Blur({
  intensity,
  dark,
  style,
}: {
  intensity: number;
  dark: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const BlurView = loadBlurView();
  if (!BlurView) return <View pointerEvents="none" style={style} />;
  return (
    <BlurView
      intensity={intensity}
      tint={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      style={style}
    />
  );
}
