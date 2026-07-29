'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import type { AuthoredEl } from '../../lib/authoredEdit';

/**
 * On-canvas copy editing for an authored slide.
 *
 * Wraps the inspector's scaled preview and, while the Studio's Edit mode is
 * on, turns every text element `authoredEdit` exposes into an in-place editing
 * surface: hover shows a text affordance, a click makes the element
 * contentEditable exactly where it sits (inside the recipe's own styling and
 * the 1080px→288px scale), blur or Enter commits, Escape reverts. Keyboard:
 * the elements are tabbable, Enter starts editing, Escape leaves.
 *
 * The live DOM is NEVER serialised. The slide render is full of app-injected
 * machinery (scoped <style>, photo layers, slot CSS) that must not leak into
 * saved HTML — so a commit reads only the element's plain TEXT and pushes it
 * through the same model the inspector fields use (`patchEl` →
 * `buildAuthored`). The `.em`/`.it` emphasis span is flattened on read and
 * re-applied by `buildAuthored` wherever the accent phrase still occurs in the
 * new text — and silently dropped when it no longer does, exactly the
 * inspector's behaviour. Photo slots, rules, logos and other structural
 * elements are never wired.
 *
 * Index mapping: `buildAuthored` emits exactly one element per AuthoredEl, in
 * order, so `.cb-slide`'s children align index-for-index with `els`.
 */
export default function CanvasCopyEditor({
  enabled,
  els,
  html,
  epoch,
  active,
  onActivate,
  onCommit,
  children,
}: {
  /** Wire the DOM only while the Studio's Edit mode owns this slide. */
  enabled: boolean;
  /** The Edit mode's working model — source of truth for what is editable. */
  els: AuthoredEl[];
  /** The rebuilt fragment currently rendered — re-wire when React swaps it. */
  html: string;
  /** Any value whose change remounts the slide (e.g. the motion replay key). */
  epoch?: unknown;
  /** The element selected on either surface (canvas or inspector list). */
  active: string | null;
  onActivate: (key: string) => void;
  /** One text commit, in model terms — same channel as the inspector fields. */
  onCommit: (key: string, text: string) => void;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  /** The element currently contentEditable, with what's needed to revert. */
  const session = useRef<{ node: HTMLElement; key: string; before: string; prior: string } | null>(
    null,
  );
  /** Element key to re-focus after React replaces the slide DOM on a commit. */
  const refocus = useRef<string | null>(null);
  // Latest callbacks without making them wiring dependencies.
  const cbs = useRef({ onActivate, onCommit });
  cbs.current = { onActivate, onCommit };

  useEffect(() => {
    if (!enabled) return;
    const slide = hostRef.current?.querySelector<HTMLElement>('.cb-slide');
    if (!slide) return;
    const kids = Array.from(slide.children) as HTMLElement[];
    const wired: Array<{ key: string; node: HTMLElement; off: () => void }> = [];

    /** End the active session: bank the text into the model, or put it back. */
    const finish = (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      s.node.classList.remove('cbe-editing');
      s.node.removeAttribute('contenteditable');
      s.node.removeAttribute('aria-multiline');
      const text = (s.node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (commit && text !== s.prior) {
        cbs.current.onCommit(s.key, text);
      } else {
        // Reverted (or unchanged): restore the exact pre-edit markup — the
        // emphasis span lives inside it.
        s.node.innerHTML = s.before;
      }
    };

    const placeCaretAtEnd = (node: HTMLElement) => {
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    };

    els.forEach((el, i) => {
      const node = kids[i];
      // Only authoredEdit's text leaves are editable — photo slots, rules,
      // spacers, logos and panels stay exactly as designed.
      if (!node || el.kind !== 'text') return;
      node.classList.add('cbe-text');
      node.dataset.cbeKey = el.key;
      node.tabIndex = 0;
      node.setAttribute('role', 'textbox');
      node.setAttribute('aria-label', `${el.label} — press Enter to edit`);
      node.setAttribute('spellcheck', 'false');

      const begin = () => {
        if (session.current?.node === node) return;
        finish(true); // moving to another element commits the one being left
        session.current = { node, key: el.key, before: node.innerHTML, prior: el.text };
        try {
          node.contentEditable = 'plaintext-only';
        } catch {
          node.contentEditable = 'true'; // older engines; the paste guard covers rich input
        }
        node.classList.add('cbe-editing');
        node.setAttribute('aria-multiline', 'false');
      };

      // pointerdown (not click), so the browser's own mousedown-on-editable
      // behaviour still lands the caret under the pointer.
      const onPointerDown = () => {
        cbs.current.onActivate(el.key);
        begin();
      };
      const onFocus = () => cbs.current.onActivate(el.key);
      const onClick = (e: MouseEvent) => {
        // An authored CTA is an <a href> — editing it must never navigate.
        if (node.tagName === 'A') e.preventDefault();
      };
      const onKeyDown = (e: KeyboardEvent) => {
        const editing = session.current?.node === node;
        if (!editing) {
          if (e.key === 'Enter') {
            e.preventDefault();
            begin();
            placeCaretAtEnd(node);
          } else if (e.key === 'Escape') {
            node.blur();
          }
          return;
        }
        if (e.key === 'Escape') {
          // Exit WITHOUT committing; the element stays focused for the keyboard.
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === 'Enter') {
          // The model is plain single-line copy (whitespace collapses on save),
          // so Enter never inserts a line — plain or Cmd/Ctrl, it commits.
          // Focus is kept so a swap of the slide DOM can restore it (below).
          e.preventDefault();
          finish(true);
        }
      };
      const onPaste = (e: ClipboardEvent) => {
        // Rich clipboard content must never enter the fragment: plain text only.
        e.preventDefault();
        const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
        if (text) document.execCommand('insertText', false, text);
      };
      const onBlur = () => {
        if (session.current?.node === node) finish(true);
      };

      node.addEventListener('pointerdown', onPointerDown);
      node.addEventListener('focus', onFocus);
      node.addEventListener('click', onClick);
      node.addEventListener('keydown', onKeyDown);
      node.addEventListener('paste', onPaste);
      node.addEventListener('blur', onBlur);
      wired.push({
        key: el.key,
        node,
        off: () => {
          node.removeEventListener('pointerdown', onPointerDown);
          node.removeEventListener('focus', onFocus);
          node.removeEventListener('click', onClick);
          node.removeEventListener('keydown', onKeyDown);
          node.removeEventListener('paste', onPaste);
          node.removeEventListener('blur', onBlur);
          node.classList.remove('cbe-text', 'cbe-editing');
          delete node.dataset.cbeKey;
          node.removeAttribute('tabindex');
          node.removeAttribute('role');
          node.removeAttribute('aria-label');
          node.removeAttribute('spellcheck');
          node.removeAttribute('contenteditable');
          node.removeAttribute('aria-multiline');
        },
      });
    });

    // A commit replaced the slide DOM out from under the focused element —
    // put the keyboard back on its successor so Tab/Enter flow keeps working.
    if (refocus.current) {
      const back = wired.find((w) => w.key === refocus.current)?.node;
      refocus.current = null;
      back?.focus({ preventScroll: true });
    }

    return () => {
      // React is about to swap this DOM. If the keyboard was on one of ours,
      // remember it; if a session is still open (an inspector edit landed
      // mid-session), bank its text rather than lose the keystrokes.
      const focused = wired.find((w) => w.node === document.activeElement);
      if (focused) refocus.current = focused.key;
      finish(true);
      wired.forEach((w) => w.off());
    };
  }, [enabled, els, html, epoch]);

  // Inspector-list → canvas sync: selecting a row focuses the element on the
  // slide. Focus is only moved when it isn't already there, so this never
  // steals the caret from a form field (the list doesn't set `active` on
  // field focus — only on row clicks).
  useEffect(() => {
    if (!enabled || !active) return;
    const node = hostRef.current?.querySelector<HTMLElement>(`[data-cbe-key="${active}"]`);
    if (node && document.activeElement !== node) node.focus({ preventScroll: true });
  }, [enabled, active]);

  return (
    <div ref={hostRef} className="cbe-host">
      {children}
    </div>
  );
}
