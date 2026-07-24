'use client';

import { useEffect, useId } from 'react';
import type { CSSProperties } from 'react';
import {
  recipeCssVars,
  recipeFontFamilies,
  recipeStylesheetFor,
  type BrandRecipe,
  type Format,
} from '@contentbuilder/shared';
import { ensureGoogleFonts } from './fontLoader';

/**
 * Renders an AI-authored slide: the brand recipe's stylesheet + `--cb-*` tokens
 * wrapped around the authored markup (already sanitised at author time). The
 * stylesheet is scoped to a per-instance class so multiple slides can render on
 * one page (editor, gallery) without their `.cb-slide` rules colliding.
 *
 * Fills its parent [data-slide-root]; the recipe's `.cb-slide` (absolute, inset 0)
 * fills this wrapper, so the composition is pixel-exact for the export screenshot.
 */
export function AuthoredSlide({
  recipe,
  authored,
  format,
  logoUrl,
  photoUrl,
}: {
  recipe: BrandRecipe;
  authored: { html: string; bg?: string };
  /** The target canvas — selects the recipe's per-format vertical tuning. */
  format: Format;
  logoUrl?: string;
  /** A real photo for a photo-role slide; the recipe's `.photo` layers it as
   *  `var(--cb-photo)` under a legibility scrim. Absent → the recipe's fallback. */
  photoUrl?: string;
}) {
  const scope = 'cbs' + useId().replace(/[^a-zA-Z0-9]/g, '');

  // Load the recipe's render fonts (display/body/accent) on every render site.
  useEffect(() => {
    ensureGoogleFonts(recipeFontFamilies(recipe.tokens));
  }, [recipe.tokens]);

  // Base stylesheet + the format's vertical override (square/story), then scope
  // every .cb-slide rule to this instance so multiple slides can share a page.
  const scopedCss = recipeStylesheetFor(recipe, format).replace(/\.cb-slide/g, `.${scope} .cb-slide`);
  // Set the logo/photo URLs in the stylesheet (a data: URL's ";base64," breaks an
  // inline style attr, so these live in a <style> rule, not the style attribute).
  const safeUrl = (u: string) => u.replace(/["\\<>]/g, '');
  const vars = [
    logoUrl ? `--cb-logo:url("${safeUrl(logoUrl)}")` : '',
    photoUrl ? `--cb-photo:url("${safeUrl(photoUrl)}")` : '',
  ].filter(Boolean);
  const varRule = vars.length ? `.${scope}{${vars.join(';')}}` : '';
  const wrapperStyle = { position: 'absolute', inset: 0, ...recipeCssVars(recipe.tokens) } as CSSProperties;
  const bgClass = authored.bg ? ` ${authored.bg.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';

  return (
    <div className={scope} style={wrapperStyle}>
      <style dangerouslySetInnerHTML={{ __html: `${varRule}\n${scopedCss}` }} />
      <div className={`cb-slide${bgClass}`} dangerouslySetInnerHTML={{ __html: authored.html }} />
    </div>
  );
}
