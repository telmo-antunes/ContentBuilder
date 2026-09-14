'use client';

import { useState } from 'react';
import type { GlossaryEntry } from '@contentbuilder/shared';
import { updateBusiness } from '../lib/api';
import { toast } from './Toast';

/**
 * THE READER'S WORDS FOR THE SYSTEM'S THINGS.
 *
 * The CRM's facts arrive in the developer's names and the copywriter, told
 * never to invent, repeats them. Only the business knows what its customers
 * call a "Send update" or a "booking record" — so it says so here, once, and
 * every deck after that is written in the right-hand column.
 */
export default function GlossaryCard({
  businessId,
  glossary,
  onSaved,
}: {
  businessId: string;
  glossary: GlossaryEntry[] | undefined;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<GlossaryEntry[]>(glossary?.length ? glossary : [{ system: '', customer: '' }]);
  const [busy, setBusy] = useState(false);

  const set = (i: number, key: keyof GlossaryEntry, value: string) =>
    setRows((r) => r.map((row, k) => (k === i ? { ...row, [key]: value } : row)));

  const save = async () => {
    const clean = rows.map((r) => ({ system: r.system.trim(), customer: r.customer.trim() })).filter((r) => r.system && r.customer);
    setBusy(true);
    try {
      await updateBusiness(businessId, { glossary: clean });
      toast(clean.length ? `${clean.length} word${clean.length === 1 ? '' : 's'} the copywriter will use.` : 'Glossary cleared.');
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the glossary', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glossary">
      <p className="glossary-lead">
        Left: what your system calls it. Right: what your customers call it. The copywriter writes the right-hand words.
      </p>
      <div className="glossary-rows">
        {rows.map((r, i) => (
          <div className="glossary-row" key={i}>
            <input
              value={r.system}
              placeholder="Send update"
              maxLength={80}
              onChange={(e) => set(i, 'system', e.target.value)}
              aria-label="What the system calls it"
            />
            <span className="glossary-arrow" aria-hidden>→</span>
            <input
              value={r.customer}
              placeholder="the message you send at handover"
              maxLength={120}
              onChange={(e) => set(i, 'customer', e.target.value)}
              aria-label="What the customer calls it"
            />
            <button
              type="button"
              className="btn sm ghost"
              aria-label="Remove this row"
              onClick={() => setRows((rs) => (rs.length === 1 ? [{ system: '', customer: '' }] : rs.filter((_, k) => k !== i)))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="glossary-actions">
        <button type="button" className="btn sm" disabled={rows.length >= 40} onClick={() => setRows((rs) => [...rs, { system: '', customer: '' }])}>
          Add a word
        </button>
        <button type="button" className="btn sm primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save glossary'}
        </button>
      </div>
    </div>
  );
}
