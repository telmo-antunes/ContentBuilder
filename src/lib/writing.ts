import { z } from 'zod';
import { sizeSchema, slideDirectionSchema, writingMessageSchema, type Workspace, type WritingMessage } from './schema';
import { activeDirections } from './directions';
import { websiteReferences } from './references';

export const writingRequestSchema = sizeSchema.extend({
  mode: z.enum(['complete', 'rephrase', 'chat']), model: z.string().max(200).optional(), brief: z.string(),
  cursor: z.number().int().nonnegative(), directions: z.array(slideDirectionSchema),
  website: z.object({ url: z.string(), notes: z.string() }).nullable(),
  references: z.array(z.object({ url: z.string(), notes: z.string() })).default([]),
  messages: z.array(writingMessageSchema).max(20).default([]),
}).refine(input => input.cursor <= input.brief.length, 'The cursor is outside the current brief.');
export const writingReplySchema = z.object({ reply: z.string(), suggestion: z.string() });
export type WritingRequest = z.infer<typeof writingRequestSchema>;
export type WritingReply = z.infer<typeof writingReplySchema>;
export type WritingMode = WritingRequest['mode'];
export function writingContext(workspace: Workspace) {
  return { brief: workspace.brief, directions: activeDirections(workspace), width: workspace.width, height: workspace.height,
    website: workspace.brand ? { url: workspace.brand.url, notes: workspace.brand.notes } : null,
    references: websiteReferences(workspace).slice(1).map(({ url, notes }) => ({ url, notes })) };
}
export function appendWritingMessage(messages: WritingMessage[], message: WritingMessage) { return [...messages, message].slice(-40); }
/** Never insert a delayed suggestion into text that has since changed. */
export function insertCompletion(current: string, source: string, cursor: number, suggestion: string): string | null {
  if (current !== source || cursor < 0 || cursor > source.length || !suggestion) return null;
  return source.slice(0, cursor) + suggestion + source.slice(cursor);
}
export function canApplyWording(current: string, source: string | undefined, suggestion: string) {
  return source !== undefined && current === source && !!suggestion.trim();
}
