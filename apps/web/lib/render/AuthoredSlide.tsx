'use client';

import { useEffect, useId, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  authoredSlots,
  ambientArtCss,
  ambientPhotoCss,
  backgroundPhotoCss,
  emptySlotCss,
  filledSlotCss,
  resolveMove,
  SLOT_ATTR,
  isSlotName,
  recipeCssVars,
  recipeFontFamilies,
  recipeStylesheetFor,
  recipeAmbient,
  recipeMotionCss,
  recipeMotionTiming,
  statCountUp,
  type BrandRecipe,
  type Format,
} from '@contentbuilder/shared';
import { ensureGoogleFonts } from './fontLoader';
import type { SlidePhotoSet } from './projectRender';

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
  photos,
  editing = false,
  motion = false,
  onOverflow,
}: {
  recipe: BrandRecipe;
  authored: { html: string; bg?: string; role?: string };
  /** The target canvas — selects the recipe's per-format vertical tuning. */
  format: Format;
  logoUrl?: string;
  /** A real photo for a photo-role slide; the recipe's `.photo` layers it as
   *  `var(--cb-photo)` under a legibility scrim. Absent → the recipe's fallback. */
  photoUrl?: string;
  /** The user's own photos: slot fills, a background, and free overlays. */
  photos?: SlidePhotoSet;
  /** Show empty-slot affordances. Off for export — a placeholder the user never
   *  filled must never reach a PNG or an MP4 as a dashed "Add photo" box. */
  editing?: boolean;
  /** Play the reveal choreography (for animated/video export). Off = still PNG. */
  motion?: boolean;
  /** Reports whether the composition exceeds the canvas (see the effect below). */
  onOverflow?: (overflow: boolean) => void;
}) {
  const scope = 'cbs' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const slideRef = useRef<HTMLDivElement | null>(null);

  // Load the recipe's render fonts (display/body/accent) on every render site.
  useEffect(() => {
    ensureGoogleFonts(recipeFontFamilies(recipe.tokens));
  }, [recipe.tokens]);

  /**
   * OVERFLOW GUARD. Authored slides had none: the recipe hardcodes px type, so a
   * long headline simply spilled off the canvas — silently, all the way into the
   * exported PNG/MP4. Measure the composition against the frame once fonts and
   * images have settled (both change metrics) and report it, so the Studio can
   * warn and the export can be trusted.
   */
  useEffect(() => {
    if (!onOverflow) return;
    let alive = true;
    const measure = () => {
      const el = slideRef.current;
      if (!el || !alive) return;
      // Measure the CONTENT children against the padding box, in the slide's own
      // LAYOUT space (offsetTop/offsetHeight) — deliberately not:
      //  · scrollHeight — recipes bleed decoration off-canvas (a ghosted
      //    monogram at `bottom:-110px`), inflating the scroll box on every slide;
      //  · getBoundingClientRect — the studio renders slides inside a CSS
      //    `transform: scale()`, so viewport rects are scaled while computed
      //    padding is not, and mixing the two flags every slide.
      const cs = getComputedStyle(el);
      const padTop = parseFloat(cs.paddingTop || '0');
      const padBottom = parseFloat(cs.paddingBottom || '0');
      const contentBottom = el.clientHeight - padBottom;
      const TOL = 2; // absorbs sub-pixel rounding
      const over = Array.from(el.children).some((child) => {
        if (!(child instanceof HTMLElement)) return false;
        if (child.offsetHeight === 0) return false; // spacers / empty nodes
        return (
          child.offsetTop + child.offsetHeight > contentBottom + TOL ||
          child.offsetTop < padTop - TOL
        );
      });
      onOverflow(over);
    };
    measure();
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    void fonts?.ready.then(measure).catch(() => {});
    const imgs = Array.from(slideRef.current?.querySelectorAll('img') ?? []);
    imgs.forEach((img) => img.addEventListener('load', measure, { once: true }));
    const t = setTimeout(measure, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [onOverflow, authored.html, format]);

  // Base stylesheet + the format's vertical override (square/story), then scope
  // every .cb-slide rule to this instance so multiple slides can share a page.
  const scopedCss = recipeStylesheetFor(recipe, format).replace(/\.cb-slide/g, `.${scope} .cb-slide`);
  // Set the logo/photo URLs in the stylesheet (a data: URL's ";base64," breaks an
  // inline style attr, so these live in a <style> rule, not the style attribute).
  const safeUrl = (u: string) => u.replace(/["\\<>]/g, '');
  // A background photo the user set beats the composer's own photo URL.
  const bgPhoto = photos?.background?.url ?? photoUrl;
  const vars = [
    logoUrl ? `--cb-logo:url("${safeUrl(logoUrl)}")` : '',
    // Still published for any recipe that wants it, but nothing depends on it:
    // NO recipe ever consumed `--cb-photo` (the author prompt never mentioned
    // it), so a background photo used to render as nothing at all. It is a real
    // layer now — see `bgLayerCss` — which is also what lets it move.
    bgPhoto ? `--cb-photo:url("${safeUrl(bgPhoto)}")` : '',
  ].filter(Boolean);
  const varRule = vars.length ? `.${scope}{${vars.join(';')}}` : '';
  // Motion mode: append the (scoped) reveal choreography + tag the slide `cb-motion`.
  // In motion mode a countable stat is rewritten so it can tick up (the still
  // export keeps the plain text, so image rendering is untouched).
  const count = motion ? statCountUp(authored.html, recipe) : null;
  const html = count?.html ?? authored.html;
  /**
   * SLOT FILLS. The user's photo is painted onto the placeholder the composer
   * authored, keyed by its `data-cb-slot` name — through CSS rather than by
   * rewriting the markup, so the stored authored HTML stays exactly what the
   * composer wrote and stays re-editable. Slot names are validated at author
   * time (see the sanitiser) and re-checked here before entering a selector.
   *
   * One rule per slot, computed from what this render knows: a filled slot gets
   * the photo, an empty one gets the "Add photo" affordance — and only while
   * editing, so exports never carry a dashed box.
   */
  const slotRules = authoredSlots(html)
    .filter(isSlotName)
    .map((name) => {
      const p = photos?.slots[name];
      if (p) return filledSlotCss(scope, name, safeUrl(p.url), p.fit, p.focal);
      return editing ? emptySlotCss(scope, name) : '';
    })
    .filter(Boolean)
    .join('\n');
  const bg = photos?.background;
  const bgLayerCss = bg
    ? backgroundPhotoCss(scope, safeUrl(bg.url), bg.fit, bg.focal)
    : '';

  /**
   * AMBIENT MOTION — the continuous parallax drift, on its own timeline from
   * the reveal. Each layer moves at its own depth, so the composition reads
   * three-dimensional: the recipe's art barely stirs, the background photo
   * drifts, a slot photo pushes in, an overlay moves most.
   *
   * The recipe's art is drifted with `background-position` and everything else
   * with a transform, because the art is painted on `.cb-slide` — which also
   * holds every word on the slide, and must not move.
   */
  const ambient = recipeAmbient(recipe);
  const ambientCss = motion
    ? [
        ambientArtCss(scope, ambient),
        bg
          ? ambientPhotoCss(
              `.${scope} .cb-bg-photo`,
              'cb-amb-bg',
              resolveMove(bg.move, bg.focal, 0),
              'background',
              ambient,
              bg.focal,
            )
          : '',
        ...authoredSlots(html)
          .filter(isSlotName)
          .map((name, i) => {
            const p = photos?.slots[name];
            return p
              ? ambientPhotoCss(
                  `.${scope} .cb-slide [${SLOT_ATTR}="${name}"]::before`,
                  `cb-amb-s${i}`,
                  resolveMove(p.move, p.focal, i),
                  'slot',
                  ambient,
                  p.focal,
                )
              : '';
          }),
        ...(photos?.free ?? []).map((p, i) =>
          ambientPhotoCss(
            `.${scope} .cb-free-img[data-p="${p.id}"]`,
            `cb-amb-f${i}`,
            resolveMove(p.move, p.focal, i),
            'free',
            ambient,
            p.focal,
          ),
        ),
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  // Per-ROLE motion: the recipe can give a stat a pop and a quote a calm fade.
  const motionCss = motion
    ? '\n' +
      recipeMotionCss(recipe, authored.role, count?.to).replace(
        // `@property`/`@keyframes` are global at-rules — only scope selectors.
        /\.cb-slide/g,
        `.${scope} .cb-slide`,
      )
    : '';
  /**
   * The free-overlay layers are SIBLINGS of `.cb-slide` (they need full-canvas
   * geometry, and the slide has padding), so `.cb-slide.cb-motion > *` never
   * reaches them — they used to appear at frame 0 with no reveal while
   * everything around them animated. They reuse the same `cb-enter` keyframes,
   * landing after the composition since they sit on top of it.
   */
  const freeMotionCss = motion
    ? (() => {
        const t = recipeMotionTiming(recipe, authored.role);
        return `\n.${scope} .cb-free-layer.cb-motion > *{animation:cb-enter ${t.dur}s ${t.ease} ${t.delay.toFixed(2)}s both}`;
      })()
    : '';
  const wrapperStyle = {
    position: 'absolute',
    inset: 0,
    ...recipeCssVars(recipe.tokens, recipe.typography),
  } as CSSProperties;
  // Setting a background photo puts the slide into the recipe's photo treatment
  // (its `.photo` rules layer `--cb-photo` under a legibility scrim), even
  // though the composer no longer decides that — the user does.
  const wantsPhotoClass = Boolean(photos?.background) && !/\bphoto\b/.test(authored.bg ?? '');
  const bgClass =
    `${authored.bg ? ` ${authored.bg.replace(/[^a-zA-Z0-9_-]/g, '')}` : ''}` +
    `${wantsPhotoClass ? ' photo' : ''}${motion ? ' cb-motion' : ''}`;

  // Free overlays split into two layers so one can sit behind the type.
  const free = photos?.free ?? [];
  const under = free.filter((p) => p.z < 0);
  const over = free.filter((p) => p.z >= 0);
  const layer = (items: typeof free, cls: 'under' | 'over') =>
    items.length ? (
      <div
        className={`cb-free-layer ${cls}${motion ? ' cb-motion' : ''}`}
        aria-hidden={cls === 'under' ? true : undefined}
      >
        {items.map((p) => (
          <img
            key={p.id}
            className="cb-free-img"
            data-p={p.id}
            src={p.url}
            alt={p.alt ?? ''}
            style={{
              // Fractions of the canvas, so a placement holds at any export size.
              left: `${(p.frame?.x ?? 0) * 100}%`,
              top: `${(p.frame?.y ?? 0) * 100}%`,
              width: `${(p.frame?.w ?? 0.4) * 100}%`,
              height: `${(p.frame?.h ?? 0.3) * 100}%`,
              objectFit: p.fit,
              objectPosition: `${((p.focal?.x ?? 0.5) * 100).toFixed(1)}% ${((p.focal?.y ?? 0.5) * 100).toFixed(1)}%`,
            }}
          />
        ))}
      </div>
    ) : null;

  return (
    <div className={scope} style={wrapperStyle}>
      {bg && (
        <div className="cb-bg-layer" aria-hidden>
          <div className="cb-bg-photo" />
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `${varRule}\n${scopedCss}\n${slotRules}\n${bgLayerCss}${motionCss}${freeMotionCss}\n${ambientCss}` }} />
      {layer(under, 'under')}
      <div
        ref={slideRef}
        className={`cb-slide${bgClass}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {layer(over, 'over')}
    </div>
  );
}
