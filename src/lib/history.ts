import type { Deck, Workspace } from './schema';

export function commitDeck(workspace: Workspace, deck: Deck, instruction: string): Workspace {
  return { ...workspace, deck, lastInstruction: instruction, redo: null,
    previous: workspace.deck ? { deck: workspace.deck, instruction: workspace.lastInstruction } : null };
}
export function travel(workspace: Workspace, direction: 'undo' | 'redo'): Workspace {
  const next = direction === 'undo' ? workspace.previous : workspace.redo;
  if (!next || !workspace.deck) return workspace;
  const current = { deck: workspace.deck, instruction: workspace.lastInstruction };
  return { ...workspace, deck: next.deck, lastInstruction: next.instruction,
    previous: direction === 'undo' ? null : current, redo: direction === 'undo' ? current : null };
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
