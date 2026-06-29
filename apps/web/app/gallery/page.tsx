'use client';

import { useState } from 'react';
import type { Format } from '@contentbuilder/shared';
import { ALLOWED_FORMATS, FORMAT_LABELS } from '@contentbuilder/shared';
import { SlideRenderer } from '../../lib/render/SlideRenderer';
import { ScaledSlide } from '../../lib/render/SlideFrame';
import type { RenderBrandKit } from '../../lib/render/types';
import {
  SAMPLE_KIT,
  SAMPLE_KIT_LIGHT,
  SAMPLE_IMAGE,
  GALLERY_SLIDES,
  OVERFLOW_SLIDE,
  type GallerySlide,
} from '../../lib/render/sampleKit';

const ALL_FORMATS: Format[] = ['1080x1080', '1080x1350', '1080x1920'];

function GalleryCard({
  slide,
  format,
  kit,
  displayWidth,
}: {
  slide: GallerySlide;
  format: Format;
  kit: RenderBrandKit;
  displayWidth: number;
}) {
  const [overflow, setOverflow] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ScaledSlide format={format} displayWidth={displayWidth}>
        <SlideRenderer
          slide={{ layoutType: slide.layoutType, blocks: slide.blocks }}
          brandKit={kit}
          format={format}
          image={slide.withImage ? SAMPLE_IMAGE : null}
          onOverflow={setOverflow}
        />
      </ScaledSlide>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span className="muted">{slide.label}</span>
        {overflow && (
          <span className="badge warn" style={{ fontSize: 11 }}>
            ⚠ text too long
          </span>
        )}
      </div>
    </div>
  );
}

export default function GalleryPage() {
  const [light, setLight] = useState(false);
  const kit = light ? SAMPLE_KIT_LIGHT : SAMPLE_KIT;

  return (
    <div>
      <h1>Layout gallery</h1>
      <p className="muted">
        All seven layout archetypes, rendered live from React across every supported format, driven by a
        hardcoded sample brand kit and type scale. No AI, no database. Toggle the kit to watch the
        contrast engine repick text colors and fonts.
      </p>

      <div className="row" style={{ margin: '12px 0 8px' }}>
        <button className={`btn sm ${!light ? 'primary' : ''}`} onClick={() => setLight(false)}>
          Dark kit
        </button>
        <button className={`btn sm ${light ? 'primary' : ''}`} onClick={() => setLight(true)}>
          Light kit
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          fonts: {kit.fonts.render.heading} / {kit.fonts.render.body}
        </span>
      </div>

      {ALL_FORMATS.map((format) => {
        const isStory = format === '1080x1920';
        const w = isStory ? 150 : 240;
        return (
          <section key={format}>
            <h2>{FORMAT_LABELS[format]}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-start' }}>
              {GALLERY_SLIDES.map((s) => (
                <GalleryCard key={s.label} slide={s} format={format} kit={kit} displayWidth={w} />
              ))}
            </div>
          </section>
        );
      })}

      <h2>Text-fit overflow warning</h2>
      <p className="muted">
        When copy can&apos;t fit even at the minimum bounded size, the renderer reports an overflow so the
        editor can warn — never clipping or shrinking below the readable minimum.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        {ALL_FORMATS.map((format) => (
          <GalleryCard
            key={format}
            slide={OVERFLOW_SLIDE}
            format={format}
            kit={kit}
            displayWidth={format === '1080x1920' ? 150 : 240}
          />
        ))}
      </div>

      <p className="muted" style={{ marginTop: 24, fontSize: 13 }}>
        Allowed formats — carousel: {ALLOWED_FORMATS.carousel.join(', ')} · story:{' '}
        {ALLOWED_FORMATS.story.join(', ')}
      </p>
    </div>
  );
}
