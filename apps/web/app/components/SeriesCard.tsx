'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { SeriesTemplate } from '@contentbuilder/shared';
import { ALLOWED_FORMATS, FORMAT_LABELS, MAX_PLAN_SLIDES, type Format } from '@contentbuilder/shared';
import { updateBusiness } from '../lib/api';
import { toast } from './Toast';

/**
 * SERIES — recurring forms with a fixed shape and variable content.
 *
 * The accounts in the swipe file build recognition by repeating a template:
 * Blinkist's "Plot twist", Monzo's question sticker, Headspace's "You are…".
 * A series here is a saved brief template plus a per-slide plan; a new post
 * starts from it and only the topic changes, so consecutive posts share a
 * skeleton on purpose rather than by accident.
 */
const blank = (): SeriesTemplate => ({ id: Math.random().toString(36).slice(2, 10), name: '', hint: '', idea: '', plan: [], format: '1080x1350' });

export default function SeriesCard({
  businessId,
  series,
  onSaved,
}: {
  businessId: string;
  series: SeriesTemplate[] | undefined;
  onSaved: () => void;
}) {
  const [list, setList] = useState<SeriesTemplate[]>(series ?? []);
  const [editing, setEditing] = useState<SeriesTemplate | null>(series?.length ? null : blank());
  const [busy, setBusy] = useState(false);

  const persist = async (next: SeriesTemplate[]) => {
    setBusy(true);
    try {
      const clean = next
        .map((s) => ({ ...s, name: s.name.trim(), hint: s.hint?.trim() || undefined, idea: s.idea?.trim() || undefined, plan: (s.plan ?? []).map((p) => p.trim()).filter(Boolean) }))
        .filter((s) => s.name);
      await updateBusiness(businessId, { series: clean });
      setList(clean);
      setEditing(null);
      toast(clean.length ? `${clean.length} series saved.` : 'No series left.');
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the series', 'error');
    } finally {
      setBusy(false);
    }
  };

  const formats = ALLOWED_FORMATS.carousel;

  return (
    <div className="series">
      <p className="glossary-lead">
        A series is a post shape you repeat: the same brief template and the same slide plan, with only the topic changing. Consecutive posts in a series look alike on purpose.
      </p>
      {list.length > 0 && (
        <div className="series-list">
          {list.map((s) => (
            <div className="series-row" key={s.id}>
              <div>
                <b>{s.name}</b>
                {s.hint ? <span className="series-hint"> — {s.hint}</span> : null}
                <div className="series-meta">
                  {(s.plan?.length ?? 0) ? `${s.plan!.length} fixed slide${s.plan!.length === 1 ? '' : 's'}` : 'free slide count'}
                  {s.format ? ` · ${FORMAT_LABELS[s.format as Format] ?? s.format}` : ''}
                </div>
              </div>
              <div className="series-actions">
                <Link className="btn sm primary" href={`/projects/new?businessId=${businessId}&series=${encodeURIComponent(s.id)}`}>
                  Start a post
                </Link>
                <button type="button" className="btn sm" onClick={() => setEditing({ ...s, plan: [...(s.plan ?? [])] })}>Edit</button>
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => void persist(list.filter((x) => x.id !== s.id))}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing ? (
        <div className="series-edit">
          <label>
            <span>Name</span>
            <input value={editing.name} maxLength={80} placeholder="Plot twist" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </label>
          <label>
            <span>What it is for</span>
            <input value={editing.hint ?? ''} maxLength={200} placeholder="One counter-intuitive line about detailing, every Monday" onChange={(e) => setEditing({ ...editing, hint: e.target.value })} />
          </label>
          <label>
            <span>Brief template</span>
            <textarea
              rows={4}
              value={editing.idea ?? ''}
              placeholder={'Write the brief the way you always brief this series. Put {{topic}} where the post’s own subject goes.'}
              onChange={(e) => setEditing({ ...editing, idea: e.target.value })}
            />
          </label>
          <label>
            <span>Slide plan, one line per slide</span>
            <textarea
              rows={Math.min(8, Math.max(3, (editing.plan?.length ?? 0) + 1))}
              value={(editing.plan ?? []).join('\n')}
              placeholder={'cover: the counter-intuitive line\nstatement: why it is true\ncta: DM the keyword'}
              onChange={(e) => setEditing({ ...editing, plan: e.target.value.split('\n').slice(0, MAX_PLAN_SLIDES) })}
            />
          </label>
          <label>
            <span>Format</span>
            <select value={editing.format ?? '1080x1350'} onChange={(e) => setEditing({ ...editing, format: e.target.value })}>
              {formats.map((f) => (
                <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
              ))}
            </select>
          </label>
          <div className="glossary-actions">
            <button type="button" className="btn sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            <button
              type="button"
              className="btn sm primary"
              disabled={busy || !editing.name.trim()}
              onClick={() => void persist(list.some((x) => x.id === editing.id) ? list.map((x) => (x.id === editing.id ? editing : x)) : [...list, editing])}
            >
              {busy ? 'Saving…' : 'Save series'}
            </button>
          </div>
        </div>
      ) : (
        <div className="glossary-actions">
          <button type="button" className="btn sm" disabled={list.length >= 20} onClick={() => setEditing(blank())}>New series</button>
        </div>
      )}
    </div>
  );
}
