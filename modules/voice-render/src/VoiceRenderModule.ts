import { NativeModule, requireOptionalNativeModule } from 'expo';

/** SPEC §6.2 (D15): one spoken text rendered into an audio file by the phone's own voice, before Start. */
export type RenderResult = { ok: true; path: string; durationMs: number } | { ok: false; reason: 'no-voice' | 'error'; message?: string };

export type VoiceInfo = { id: string; name: string; language: string; quality: 'default' | 'enhanced' | 'premium'; offline: boolean };

declare class VoiceRenderModule extends NativeModule {
  /** language: BCP-47 tag ("en-US", "de"); voiceId: a VoiceInfo.id or null for the language's default voice.
   *  outPath: absolute file path (no file:// prefix); iOS writes CAF, Android WAV. */
  render(text: string, language: string, voiceId: string | null, outPath: string): Promise<RenderResult>;
  /** Offline voices whose language starts with `language` (network voices are filtered out on Android). */
  voices(language: string): Promise<VoiceInfo[]>;
}

/** null in Jest, on web and in builds without the module. */
export default requireOptionalNativeModule<VoiceRenderModule>('VoiceRender');
