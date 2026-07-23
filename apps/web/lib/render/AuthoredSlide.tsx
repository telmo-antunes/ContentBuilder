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
}: {
  recipe: BrandRecipe;
  authored: { html: string; bg?: string };
  /** The target canvas — selects the recipe's per-format vertical tuning. */
  format: Format;
  logoUrl?: string;
}) {
  const scope = 'cbs' + useId().replace(/[^a-zA-Z0-9]/g, '');

  // Load the recipe's render fonts (display/body/accent) on every render site.
  useEffect(() => {
    ensureGoogleFonts(recipeFontFamilies(recipe.tokens));
  }, [recipe.tokens]);

  // Base stylesheet + the format's vertical override (square/story), then scope
  // every .cb-slide rule to this instance so multiple slides can share a page.
  const scopedCss = recipeStylesheetFor(recipe, format).replace(/\.cb-slide/g, `.${scope} .cb-slide`);
  // Set the logo URL in the stylesheet (a data: URL's ";base64," breaks an inline style attr).
  const logoRule = logoUrl ? `.${scope}{--cb-logo:url("${logoUrl.replace(/["\\<>]/g, '')}")}` : '';
  const wrapperStyle = { position: 'absolute', inset: 0, ...recipeCssVars(recipe.tokens) } as CSSProperties;
  const bgClass = authored.bg ? ` ${authored.bg.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';

  return (
    <div className={scope} style={wrapperStyle}>
      <style dangerouslySetInnerHTML={{ __html: `${logoRule}\n${scopedCss}` }} />
      <div className={`cb-slide${bgClass}`} dangerouslySetInnerHTML={{ __html: authored.html }} />
    </div>
  );
}
