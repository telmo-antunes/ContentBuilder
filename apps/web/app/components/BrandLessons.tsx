'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Lesson } from '@contentbuilder/shared';
import { getBrandLessons, setLessonMuted } from '../lib/api';
import { Icon } from './Icon';
import { toast } from './Toast';

/**
 * WHAT THIS BRAND HAS TAUGHT THE COPYWRITER.
 *
 * The corrections its owner has made to previous posts, aggregated
 * deterministically and shown WITH THEIR EVIDENCE — because "your headlines get
 * cut" is a horoscope, and "cut on four of your last six posts, by about
 * fourteen characters, here they are" is a finding a person can agree or
 * disagree with.
 *
 * Which is the point of the switch. Every lesson comes from the user's own
 * edits, so the only honest response to "no, I did not mean that" is to stop
 * applying it — not to argue, and not to pretend it was never observed.
 */
export default function BrandLessons({ businessId }: { businessId: string }) {
  const [lessons, setLessons] = useState<Array<Lesson & { muted: boolean }> | null>(null);
  const [posts, setPosts] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    getBrandLessons(businessId)
      .then((r) => {
        setLessons(r.lessons);
        setPosts(r.posts);
      })
      // Silent: a brand that has never been composed for has nothing to say
      // here, and an error fetching an optional panel is not worth a toast.
      .catch(() => setLessons([]));
  }, [businessId]);

  useEffect(load, [load]);

  const toggle = async (lesson: Lesson & { muted: boolean }) => {
    setBusy(lesson.id);
    try {
      const r = await setLessonMuted(businessId, lesson.id, !lesson.muted);
      setLessons(r.lessons);
      toast(lesson.muted ? 'Applying this again.' : 'Ignoring this from now on.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change that', 'error');
    } finally {
      setBusy(null);
    }
  };

  // Nothing observed yet, or nothing that repeated: say nothing rather than
  // occupy the screen with an empty state about a feature that works by itself.
  if (!lessons?.length) return null;

  const applied = lessons.filter((l) => !l.muted).length;

  return (
    <section className="lessons card">
      <div className="lessons-head">
        <div>
          <span className="lab">
            <Icon name="sparkle" size={12} /> What this brand has taught the AI
          </span>
          <p className="muted">
            Picked up from your own edits across {posts} {posts === 1 ? 'post' : 'posts'}. {applied} of{' '}
            {lessons.length} {applied === 1 ? 'is' : 'are'} applied to every new post.
          </p>
        </div>
      </div>

      <ul className="lessons-list">
        {lessons.map((l) => (
          <li key={l.id} className={l.muted ? 'muted-off' : undefined}>
            <div className="row">
              <span className="what">{l.summary}</span>
              <button
                type="button"
                className="btn sm ghost"
                disabled={busy === l.id}
                title={l.muted ? 'Apply this again' : 'Stop applying this'}
                onClick={() => toggle(l)}
              >
                {l.muted ? 'Apply' : 'Ignore'}
              </button>
            </div>
            <button
              type="button"
              className="why"
              aria-expanded={open === l.id}
              onClick={() => setOpen(open === l.id ? null : l.id)}
            >
              {open === l.id ? 'Hide' : 'Show'} the {l.evidence.length === 1 ? 'edit' : `${l.evidence.length} edits`} this
              came from
            </button>
            {open === l.id && (
              <div className="evidence">
                <p className="instruction">
                  The copywriter is told: <em>{l.instruction}</em>
                </p>
                {l.evidence.map((e, i) => (
                  <div className="ev" key={`${e.projectId}-${i}`}>
                    {e.title ? <span className="post">{e.title}</span> : null}
                    <span className="before">{e.before || '(nothing)'}</span>
                    <Icon name="arrow-down" size={11} />
                    <span className="after">{e.after || '(deleted)'}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
