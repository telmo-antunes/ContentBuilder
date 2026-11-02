'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { previewAsset } from '@/lib/client';
import { slideDocument } from '@/lib/document';

export const SlidePreview = memo(function SlidePreview({ html, width, height, index, actualSize = false, thumbnail = false, fill = false, assets }: {
  // fill: the parent sets the size, the slide scales to its width.
  html: string; width: number; height: number; index: number; actualSize?: boolean; thumbnail?: boolean; fill?: boolean; assets?: Record<string, string>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [hydrated, setHydrated] = useState<{ key: string; values: Record<string, string> }>({ key: '', values: {} });
  const [assetError, setAssetError] = useState('');
  const [loaded, setLoaded] = useState('');
  const assetKey = JSON.stringify(assets ?? {});
  useEffect(() => {
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
