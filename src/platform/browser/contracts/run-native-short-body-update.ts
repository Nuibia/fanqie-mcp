import {
  type NativeShortBodyApiResult,
  type NativeShortBodyBrowserOptions,
} from '../../short-native-body-api.js';

export type RunNativeShortBodyUpdateOperation = (
  workId: string,
  options: NativeShortBodyBrowserOptions,
) => Promise<NativeShortBodyApiResult>;
