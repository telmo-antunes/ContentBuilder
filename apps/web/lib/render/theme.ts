import type { ThemePreset } from '@contentbuilder/shared';
import type { RenderBrandKit } from './types';
import { mix, rgba } from './color';

export type EyebrowStyle = 'rule' | 'chip' | 'plain' | 'pill';

export interface ThemeTokens {
  /** CSS background for the slide surface. */
  surface: (kit: RenderBrandKit) => string;
  /** How the eyebrow block is decorated. */
  eyebrow: EyebrowStyle;
  /** Accent-rule shape; 'none' hides it. */
  rule: 'line' | 'block' | 'pill' | 'none';
  /** Panel / frame corner rounding (px on the 1080 canvas). */
  radius: number;
}

export function themeTokens(theme: ThemePreset): ThemeTokens {
  switch (theme) {
    case 'bold':
      return {
        eyebrow: 'chip',
        rule: 'block',
        radius: 18,
        surface: (kit) =>
          [
            `radial-gradient(120% 100% at 100% 0%, ${rgba(kit.colors.primary, 0.28)}, transparent 52%)`,
            `radial-gradient(120% 100% at 0% 100%, ${rgba(kit.colors.accent, 0.2)}, transparent 50%)`,
            `linear-gradient(155deg, ${mix(kit.colors.background, kit.colors.secondary, 0.25)} 0%, ${kit.colors.background} 100%)`,
          ].join(', '),
      };
    case 'minimal':
      return {
        eyebrow: 'plain',
        rule: 'none',
        radius: 8,
        surface: (kit) =>
          `radial-gradient(120% 90% at 100% 0%, ${rgba(kit.colors.primary, 0.06)}, transparent 60%), ${kit.colors.background}`,
      };
    case 'soft':
      return {
        eyebrow: 'pill',
        rule: 'pill',
        radius: 36,
        surface: (kit) =>
          [
            `radial-gradient(120% 110% at 50% -10%, ${rgba(kit.colors.primary, 0.14)}, transparent 60%)`,
            `radial-gradient(100% 80% at 0% 100%, ${rgba(kit.colors.accent, 0.12)}, transparent 55%)`,
            `linear-gradient(180deg, ${mix(kit.colors.background, kit.colors.secondary, 0.22)} 0%, ${kit.colors.background} 90%)`,
          ].join(', '),
      };
    case 'editorial':
    default:
      return {
        eyebrow: 'rule',
        rule: 'line',
        radius: 16,
        surface: (kit) =>
          [
            `radial-gradient(135% 95% at 100% 0%, ${rgba(kit.colors.primary, 0.16)}, transparent 56%)`,
            `radial-gradient(120% 85% at 0% 100%, ${rgba(kit.colors.accent, 0.12)}, transparent 52%)`,
            `linear-gradient(158deg, ${kit.colors.background} 0%, ${mix(kit.colors.background, kit.colors.secondary, 0.4)} 100%)`,
          ].join(', '),
      };
  }
}
