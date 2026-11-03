import { z } from 'zod';
import { workspaceSchema, type Workspace } from './schema';

// A post set aside: everything that belongs to it, but not the brand, format defaults or settings.
export const postSchema = workspaceSchema.pick({
  brief: true, slideDirectionsEnabled: true, slideDirections: true, slideCount: true, deck: true, previous: true, redo: true,
  history: true, future: true, lastInstruction: true, revisionTarget: true, agent: true, width: true, height: true, profileId: true,
}).extend({ spent: z.number().nonnegative().default(0) });
export type Post = z.infer<typeof postSchema>;
export const draftIdSchema = z.string().uuid();
export interface DraftSummary {
  id: string; savedAt: string; title: string; slides: number; profileId: string;
  cover: { html: string; width: number; height: number; assets?: Record<string, string> } | null;
}

export function postOf(workspace: Workspace): Post {
  const { brief, slideDirectionsEnabled, slideDirections, slideCount, deck, previous, redo, history, future, lastInstruction, revisionTarget, agent, width, height, profileId } = workspace;
  return { brief, slideDirectionsEnabled, slideDirections, slideCount, deck, previous, redo, history, future, lastInstruction, revisionTarget, agent, width, height, profileId, spent: workspace.spend.post };
}
/** Puts a post into the workspace; the brand and settings stay. */
export function withPost(workspace: Workspace, post: Post): Workspace {
  const { spent, ...fields } = post;
  return { ...workspace, ...fields, profileId: workspace.profileId, spend: { ...workspace.spend, post: spent } };
}
export function hasPost(workspace: Workspace): boolean {
  return !!(workspace.brief.trim() || workspace.deck || workspace.agent.messages.length);
}
export function summarize(id: string, savedAt: string, post: Post): DraftSummary {
  const cover = post.deck?.slides[0];
  const assets = post.deck?.assets && cover ? Object.fromEntries(Object.entries(post.deck.assets).filter(([url]) => cover.html.includes(url) || cover.html.includes(url.replaceAll('&', '&amp;')))) : undefined;
  return { id, savedAt, profileId: post.profileId, slides: post.deck?.slides.length ?? 0,
    title: post.deck?.title || post.brief.trim().split('\n')[0].slice(0, 80) || 'Untitled post',
    cover: post.deck && cover ? { html: cover.html, width: post.deck.width, height: post.deck.height, ...(assets ? { assets } : {}) } : null };
}
