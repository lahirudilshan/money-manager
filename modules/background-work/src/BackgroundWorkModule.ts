import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

type Events = { onExpire: () => void };

declare class BackgroundWorkModule extends NativeModule<Events> {
  isSupported(): boolean;
  start(suffix: string, title: string, subtitle: string): boolean;
  update(title: string, subtitle: string, done: number, total: number): void;
  finish(success: boolean): void;
}

/** Null in a build made before this module was added — see backgroundWork.ts. */
export default requireOptionalNativeModule<BackgroundWorkModule>('BackgroundWork');
