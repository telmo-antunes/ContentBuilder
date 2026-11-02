'use client';
import { useMemo } from 'react';
import { changedSensitiveKinds, highlightedPart, wordingDiff } from '@/lib/wording-diff';
export function WordingDiff({ before, after }: { before: string; after: string }) {
  const comparison = useMemo(() => ({ ...wordingDiff(before, after), sensitive: changedSensitiveKinds(before, after) }), [before, after]);
  if (before === after) return <p className="field-hint">No wording changes.</p>;
  return <details className="wording-diff" open><summary>Review wording changes</summary>
    <p className="field-hint"><del>Removed</del> · <ins>Added</ins>. Highlighted changes touch quoted copy, numbers or slide-count wording.</p>
    {comparison.sensitive.length ? <p className="diff-attention">Review: {comparison.sensitive.map(kind => ['quoted wording', 'numbers', 'slide-count wording'][kind]).join(', ')}.</p> : null}
    <div className="diff-copy" aria-label="Wording comparison">{comparison.parts.map((part, i) => {
      const content = highlightedPart(part, part.kind === 'removed' ? before : after).map((piece, j) => piece.important ? <mark key={j}>{piece.text}</mark> : piece.text);
      return part.kind === 'added' ? <ins key={i} aria-label={`Added: ${part.text}`}>{content}</ins> : part.kind === 'removed' ? <del key={i} aria-label={`Removed: ${part.text}`}>{content}</del> : <span key={i}>{part.text}</span>;
    })}</div>
    {comparison.grouped ? <p className="field-hint">Long changes are grouped into passages to keep the editor responsive.</p> : null}
  </details>;
}
