'use client';

import { useEffect, useId } from 'react';
import type { CSSProperties } from 'react';
import {
  recipeCssVars,
  recipeFontFamilies,
  recipeStylesheetFor,
  recipeMotionCss,
  statCountUp,
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
  motion = false,
}: {
  recipe: BrandRecipe;
  authored: { html: string; bg?: string; role?: string };
  /** The target canvas — selects the recipe's per-format vertical tuning. */
  format: Format;
  logoUrl?: string;
  /** A real photo for a photo-role slide; the recipe's `.photo` layers it as
   *  `var(--cb-photo)` under a legibility scrim. Absent → the recipe's fallback. */
  photoUrl?: string;
  /** Play the reveal choreography (for animated/video export). Off = still PNG. */
  motion?: boolean;
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
  // Motion mode: append the (scoped) reveal choreography + tag the slide `cb-motion`.
  // In motion mode a countable stat is rewritten so it can tick up (the still
  // export keeps the plain text, so image rendering is untouched).
  const count = motion ? statCountUp(authored.html, recipe) : null;
  const html = count?.html ?? authored.html;
  // Per-ROLE motion: the recipe can give a stat a pop and a quote a calm fade.
  const motionCss = motion
    ? '\n' +
      recipeMotionCss(recipe, authored.role, count?.to).replace(
        // `@property`/`@keyframes` are global at-rules — only scope selectors.
        /\.cb-slide/g,
        `.${scope} .cb-slide`,
      )
    : '';
  const wrapperStyle = { position: 'absolute', inset: 0, ...recipeCssVars(recipe.tokens) } as CSSProperties;
  const bgClass = `${authored.bg ? ` ${authored.bg.replace(/[^a-zA-Z0-9_-]/g, '')}` : ''}${motion ? ' cb-motion' : ''}`;

  return (
    <div className={scope} style={wrapperStyle}>
      <style dangerouslySetInnerHTML={{ __html: `${varRule}\n${scopedCss}${motionCss}` }} />
      <div className={`cb-slide${bgClass}`} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
