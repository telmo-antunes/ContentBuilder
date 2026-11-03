import { MAX_VERSIONS, type Deck, type Version, type Workspace } from './schema';

// Older drafts kept one version in previous/redo; read those as one-entry stacks.
export function undoStack(workspace: Workspace): Version[] { return workspace.history?.length ? workspace.history : workspace.previous ? [workspace.previous] : []; }
export function redoStack(workspace: Workspace): Version[] { return workspace.future?.length ? workspace.future : workspace.redo ? [workspace.redo] : []; }
function withStacks(workspace: Workspace, history: Version[], future: Version[]): Workspace {
  history = history.slice(-MAX_VERSIONS); future = future.slice(-MAX_VERSIONS);
  return { ...workspace, history, future, previous: history.at(-1) ?? null, redo: future.at(-1) ?? null };
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 64);
/** Every committed deck is a new version with its own id. */
export function commitDeck(workspace: Workspace, deck: Deck, instruction: string): Workspace {
  deck = { ...deck, id: newId() };
  const history = workspace.deck ? [...undoStack(workspace), { deck: workspace.deck, instruction: workspace.lastInstruction }] : undoStack(workspace);
  return withStacks({ ...workspace, deck, lastInstruction: instruction }, history, []);
}
export function travel(workspace: Workspace, direction: 'undo' | 'redo', steps = 1): Workspace {
  let history = undoStack(workspace), future = redoStack(workspace);
  let current = workspace.deck ? { deck: workspace.deck, instruction: workspace.lastInstruction } : null;
  for (let step = 0; step < steps; step++) {
    const from = direction === 'undo' ? history : future;
    const next = from.at(-1);
    if (!next || !current) break;
    if (direction === 'undo') { history = history.slice(0, -1); future = [...future, current]; }
    else { future = future.slice(0, -1); history = [...history, current]; }
    current = next;
  }
  if (!current) return workspace;
  return withStacks({ ...workspace, deck: current.deck, lastInstruction: current.instruction }, history, future);
}
/** Finds a version by id: where it sits, and how to bring it back. */
export function findVersion(workspace: Workspace, id: string) {
  return versions(workspace).find(item => item.version.deck.id === id) ?? null;
}
// Every saved version, newest first, with the step count that restores it.
export function versions(workspace: Workspace): { version: Version; direction: 'undo' | 'redo' | null; steps: number }[] {
  const current = workspace.deck ? [{ version: { deck: workspace.deck, instruction: workspace.lastInstruction }, direction: null, steps: 0 }] : [];
  return [
    // The redo stack ends with the next version, so its first entry is the newest.
    ...redoStack(workspace).map((version, i, all) => ({ version, direction: 'redo' as const, steps: all.length - i })),
    ...current,
    ...undoStack(workspace).map((version, i, all) => ({ version, direction: 'undo' as const, steps: all.length - i })).reverse(),
  ];
}
export function changeSlide(deck: Deck, index: number, action: 'earlier' | 'later' | 'duplicate' | 'delete'): { deck: Deck; index: number } {
  const slides = [...deck.slides];
  const origins = deck.slides.map((_, i) => i + 1);
  if (!slides[index]) return { deck, index: 0 };
  if (action === 'duplicate') { slides.splice(index + 1, 0, slides[index]); origins.splice(index + 1, 0, origins[index]); index++; }
  if (action === 'delete' && slides.length > 1) { slides.splice(index, 1); origins.splice(index, 1); index = Math.min(index, slides.length - 1); }
  const target = action === 'earlier' ? index - 1 : action === 'later' ? index + 1 : index;
  if (target >= 0 && target < slides.length && target !== index) { [slides[index], slides[target]] = [slides[target], slides[index]]; [origins[index], origins[target]] = [origins[target], origins[index]]; index = target; }
  const directions = deck.originSlideDirections;
  return { deck: { ...deck, slides, ...(directions ? { originSlideDirections: origins.flatMap((origin, i) => directions.filter(d => d.slide === origin).map(d => ({ ...d, slide: i + 1 }))) } : {}) }, index };
}
// Replace one slide with a chosen alternative.
export function replaceSlide(deck: Deck, index: number, html: string, assets: Deck['assets'] = {}): Deck {
  return { ...deck, assets: { ...deck.assets, ...assets }, slides: deck.slides.map((slide, i) => i === index ? { html, ...(slide.alt ? { alt: slide.alt } : {}) } : slide) };
}
