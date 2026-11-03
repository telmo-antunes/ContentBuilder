import { parseCanvas } from './formats';
import { undoStack, redoStack } from './history';
import { type AgentAction, type AgentMessage, type RevisionReference, type Workspace } from './schema';

export function appendAgentMessage(messages: AgentMessage[], message: AgentMessage) { return [...messages, message].slice(-100); }
export function agentReferences(workspace: Workspace): RevisionReference[] {
  const images = new Map<string, RevisionReference>();
  for (const image of [...workspace.agent.messages.slice(-30).flatMap(message => message.attachments ?? []), ...workspace.agent.references, ...workspace.revisionReferences]) images.set(image.original, image);
  return [...images.values()].slice(-8);
}
export function agentContextKey(workspace: Workspace, selected: number) {
  const source = JSON.stringify([workspace.brief, workspace.slideDirectionsEnabled, workspace.slideDirections, workspace.width, workspace.height, workspace.deck, workspace.brand, workspace.references, workspace.models, workspace.revisionText, workspace.revisionReferences, agentReferences(workspace), workspace.previous, workspace.redo, selected]);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${source.length}:${hash >>> 0}`;
}
export function actionLabel(action: AgentAction) {
  switch (action.type) {
    case 'analyze': return `Analyze ${action.url}`;
    case 'generate': return 'Create slides';
    case 'revise': return action.target === null ? 'Revise the whole deck' : `Revise slide ${action.target + 1}`;
    case 'inspect': return 'Check the slides';
    case 'export': return action.target === null ? 'Download all PNGs' : `Download slide ${action.target + 1}`;
    case 'undo': return 'Undo the last change';
    case 'redo': return 'Redo the last change';
    case 'set_brief': return 'Use this brief';
    case 'move_earlier': return `Move slide ${(action.target ?? 0) + 1} earlier`;
    case 'move_later': return `Move slide ${(action.target ?? 0) + 1} later`;
    case 'duplicate': return `Duplicate slide ${(action.target ?? 0) + 1}`;
    case 'delete': return `Delete slide ${(action.target ?? 0) + 1}`;
    case 'set_canvas': return `Switch to ${action.instruction || 'another format'}`;
    case 'remix': return `Make a ${action.instruction || 'new'} version`;
  }
}
export function validateAgentAction(action: AgentAction, workspace: Workspace): string | null {
  if (['revise', 'inspect', 'export', 'undo', 'redo', 'move_earlier', 'move_later', 'duplicate', 'delete', 'remix'].includes(action.type) && !workspace.deck) return 'There are no slides yet. Create a deck first.';
  if (action.target !== null && (!workspace.deck || action.target >= workspace.deck.slides.length)) return 'That slide is no longer available. Ask for an updated plan.';
  if (['generate', 'revise', 'set_brief'].includes(action.type) && !action.instruction.trim()) return 'The agent did not include the instructions for this action. Ask it to try again.';
  if (action.type === 'analyze') { try { const url = new URL(action.url); if (!['https:', 'http:'].includes(url.protocol)) return 'Use a public website URL.'; } catch { return 'The agent needs a complete website URL.'; } }
  if (action.type === 'undo' && !undoStack(workspace).length) return 'There is no earlier change to undo.';
  if (action.type === 'redo' && !redoStack(workspace).length) return 'There is no change to redo.';
  if ((action.type === 'set_canvas' || action.type === 'remix') && !parseCanvas(action.instruction)) return 'Name a format: post, square, story, or a size such as 1080x1920.';
  if (['move_earlier', 'move_later', 'duplicate', 'delete'].includes(action.type) && action.target === null) return 'Choose a slide for this action.';
  if (action.type === 'delete' && workspace.deck?.slides.length === 1) return 'Keep at least one slide in the deck.';
  if (action.type === 'move_earlier' && action.target === 0 || action.type === 'move_later' && action.target === (workspace.deck?.slides.length ?? 0) - 1) return 'That slide is already at the edge of the deck.';
  const available = new Set(agentReferences(workspace).map(image => image.original));
  if (action.referenceUrls.some(url => !available.has(url))) return 'A reference image is no longer available. Attach it again before continuing.';
  return null;
}
export function requiresProposal(action: AgentAction) { return !['analyze', 'inspect', 'export'].includes(action.type); }
