'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cachedPreviewAsset, previewAsset } from '@/lib/client';
import { slideDocument } from '@/lib/document';

export const SlidePreview = memo(function SlidePreview({ html, width, height, index, actualSize = false, thumbnail = false, fill = false, assets }: {
  // fill: the parent sets the size, the slide scales to its width.
  html: string; width: number; height: number; index: number; actualSize?: boolean; thumbnail?: boolean; fill?: boolean; assets?: Record<string, string>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const assetKey = JSON.stringify(assets ?? {});
  // Assets read before are used straight away, so switching views shows the slide without a blank wait.
  const [hydrated, setHydrated] = useState<{ key: string; values: Record<string, string> }>(() => ({ key: cachedValues(assetKey) ? assetKey : '', values: cachedValues(assetKey) ?? {} }));
  const [assetError, setAssetError] = useState('');
  const [loaded, setLoaded] = useState('');
  useEffect(() => {
    const cached = cachedValues(assetKey);
    if (cached) { setHydrated(current => current.key === assetKey ? current : { key: assetKey, values: cached }); return; }
    let current = true; setAssetError('');
    const references = JSON.parse(assetKey) as Record<string, string>;
    void Promise.all(Object.entries(references).map(async ([url, ref]) => [url, await previewAsset(ref)] as const))
      .then(items => { if (current) setHydrated({ key: assetKey, values: Object.fromEntries(items) }); })
      .catch(error => { if (current) setAssetError(error.message); });
    return () => { current = false; };
  }, [assetKey]);
  const document = useMemo(() => slideDocument(html, hydrated.values), [html, hydrated.values]);
  const assetReady = assetKey === '{}' || hydrated.key === assetKey;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, [width]);
  return <div className={`slide-frame${thumbnail ? ' miniature' : ''}${loaded === document ? ' loaded' : ''}`} ref={container} style={{ aspectRatio: `${width}/${height}`,
    width: actualSize ? width : '100%', maxWidth: actualSize || thumbnail || fill ? 'none' : `min(100%, calc(clamp(280px, 100svh - 360px, 640px) * ${width / height}))` }}>
    {assetError ? <p className="preview-error" role="alert">{assetError}</p> : !assetReady ? <p className="preview-error" aria-busy="true" /> : <iframe key={document} title={`Slide ${index + 1}`} sandbox="" referrerPolicy="no-referrer" srcDoc={document} tabIndex={-1}
      aria-hidden={thumbnail || undefined} loading={thumbnail ? 'lazy' : 'eager'} onLoad={() => setLoaded(document)}
      style={{ width, height, transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }} />}
  </div>;
});
function cachedValues(assetKey: string): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const [url, reference] of Object.entries(JSON.parse(assetKey) as Record<string, string>)) {
    const value = cachedPreviewAsset(reference); if (value === undefined) return null; values[url] = value;
  }
  return values;
}
