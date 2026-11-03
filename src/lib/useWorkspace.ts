'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyWorkspace, type Workspace } from './schema';
import { ClientError, jsonRequest } from './client';
import { readRecovery, writeRecovery, recoveryPrefix, type Recovery } from './recovery';
import { sameStacks, stacksOf, withoutStacks } from './history';

type SaveStatus = 'saved' | 'saving' | 'error' | 'conflict';
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [backupError, setBackupError] = useState('');
  const recoveryKey = useRef('');
  const backupTimer = useRef<ReturnType<typeof setTimeout>>();
  const state = useRef({ latest: emptyWorkspace, saved: emptyWorkspace, json: '', version: '', blocked: false });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const loadId = useRef(0);
  const load = useCallback(async () => {
    const id = ++loadId.current;
    setError('');
    try {
      const result = await jsonRequest<{ workspace: Workspace; version: string; configured: boolean }>('workspace');
      if (id !== loadId.current) return;
      state.current = { latest: result.workspace, saved: result.workspace, json: JSON.stringify(withoutStacks(result.workspace)), version: result.version, blocked: false };
      setWorkspace(result.workspace); setConfigured(result.configured); setStatus('saved'); setReady(true);
      try {
        let id = sessionStorage.getItem('contentbuilder-tab');
        if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('contentbuilder-tab', id); }
        recoveryKey.current = recoveryPrefix + id;
        const candidates = Object.keys(localStorage).filter(key => key.startsWith(recoveryPrefix)).map(key => readRecovery(localStorage, key)).filter((item): item is Recovery => !!item);
        const pending = candidates.filter(item => item.keptStacks ? JSON.stringify(item.workspace) !== JSON.stringify(withoutStacks(result.workspace)) : JSON.stringify(item.workspace) !== JSON.stringify(result.workspace)).sort((a, b) => Number(b.key === recoveryKey.current) - Number(a.key === recoveryKey.current) || b.savedAt - a.savedAt)[0];
        setRecovery(pending ?? null);
      } catch { setBackupError('Browser recovery storage is unavailable. Server autosave still works.'); }
    } catch (error) { if (id === loadId.current) { setError((error as Error).message); setStatus('error'); } }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const backup = useCallback(() => {
    clearTimeout(backupTimer.current);
    if (!recoveryKey.current || state.current.latest === state.current.saved) return;
    // Unchanged versions are already on the server; the backup carries only what changed.
    const keep = sameStacks(state.current.latest, state.current.saved);
    try { writeRecovery(localStorage, recoveryKey.current, keep ? withoutStacks(state.current.latest) : state.current.latest, state.current.version, keep); setBackupError(''); }
    catch { setBackupError('Browser recovery storage is full or unavailable. Save a portable draft if server saving fails.'); }
  }, []);

  const edit = useCallback((change: Workspace | ((current: Workspace) => Workspace)) => {
    const next = typeof change === 'function' ? change(state.current.latest) : change;
    state.current.latest = next;
    setWorkspace(next);
    clearTimeout(backupTimer.current); backupTimer.current = setTimeout(backup, 100);
  }, [backup]);

  const flush = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (state.current.blocked) return Promise.resolve(false);
    const work = async () => {
      try {
        while (state.current.latest !== state.current.saved) {
          const snapshot = state.current.latest;
          // Only serialize after the debounce, once per coalesced snapshot. Unchanged versions stay on the server.
          const keepStacks = sameStacks(snapshot, state.current.saved);
          const json = JSON.stringify(withoutStacks(snapshot));
          if (keepStacks && json === state.current.json) { state.current.saved = snapshot; break; }
          setStatus('saving');
          const response = await fetch('/api/workspace', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: `{"version":${JSON.stringify(state.current.version)},"keepStacks":${keepStacks},"workspace":${keepStacks ? json : JSON.stringify(snapshot)}}` });
          const result = await response.json();
          if (!response.ok) throw new ClientError(result.error || 'Could not save your draft.', response.status);
          state.current.version = result.version; state.current.json = json; state.current.saved = snapshot;
        }
        try { if (recoveryKey.current) localStorage.removeItem(recoveryKey.current); } catch { /* server save succeeded */ }
        setStatus('saved'); setError(''); return true;
      } catch (error) {
        const conflict = error instanceof ClientError && error.status === 409;
        state.current.blocked = conflict;
        setStatus(conflict ? 'conflict' : 'error'); setError((error as Error).message); return false;
      } finally { inFlight.current = null; }
    };
    // The microtask ensures finally cannot run before inFlight is assigned.
    inFlight.current = Promise.resolve().then(work);
    return inFlight.current;
  }, []);

  useEffect(() => {
    if (!ready || workspace === state.current.saved || state.current.blocked) return;
    setStatus('saving');
    const timer = setTimeout(() => { void flush(); }, 350);
    return () => clearTimeout(timer);
  }, [workspace, ready, flush]);
  function recover() {
    if (!recovery) return;
    // Restoration deliberately replaces the currently loaded draft, using its
    // version. A newer concurrent save still receives the normal 409 protection.
    edit(recovery.keptStacks ? { ...recovery.workspace, ...stacksOf(state.current.latest) } : recovery.workspace);
    try { localStorage.removeItem(recovery.key); } catch { /* best effort */ }
    setRecovery(null); backup();
  }
  function dismissRecovery() { if (recovery) { try { localStorage.removeItem(recovery.key); } catch { /* best effort */ } } setRecovery(null); }
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') backup(); };
    window.addEventListener('pagehide', backup); document.addEventListener('visibilitychange', hidden);
    return () => { backup(); window.removeEventListener('pagehide', backup); document.removeEventListener('visibilitychange', hidden); };
  }, [backup]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.current.latest !== state.current.saved) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const getWorkspace = useCallback(() => state.current.latest, []);
  return { workspace, getWorkspace, edit, ready, configured, status, error, flush, load, recovery, recover, dismissRecovery, backupError };
}
