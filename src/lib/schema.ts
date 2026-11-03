import { z } from 'zod';

// These bounds protect the browser's memory, not the slide's design.
export const sizeSchema = z.object({
  width: z.number().int().min(200).max(2400),
  height: z.number().int().min(200).max(2400),
});
export const assetReference = z.string().regex(/^\/api\/assets\/[a-f0-9]{64}\.(jpg|png|webp|gif|svg|avif)$/);
export const slideSchema = z.object({ html: z.string().min(1), diagnostics: z.array(z.string()).optional(), renderedText: z.string().optional() });
export const slideDirectionSchema = z.object({ slide: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), text: z.string() });
export const slideDirectionDraftSchema = slideDirectionSchema.extend({ id: z.string().min(1) });
export const deckSchema = sizeSchema.extend({
  title: z.string(),
  slides: z.array(slideSchema).min(1),
  originBrief: z.string().optional(),
  originSlideDirections: z.array(slideDirectionSchema).optional(),
  originTask: z.string().optional(),
  assets: z.record(assetReference).optional(),
});
const imageReference = z.string().refine(value => /^data:image\/jpeg;base64,/.test(value) || /^\/api\/assets\/[a-f0-9]{64}\.jpg$/.test(value), 'Invalid reference image');
export const MAX_REVISION_REFERENCES = 8;
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
export const revisionReferenceSchema = z.object({
  name: z.string().min(1).max(200), original: assetReference,
  preview: assetReference.refine(value => value.endsWith('.jpg')), thumbnail: assetReference.refine(value => value.endsWith('.jpg')),
  width: z.number().int().positive(), height: z.number().int().positive(),
});
export type RevisionReference = z.infer<typeof revisionReferenceSchema>;
export const brandSchema = z.object({
  url: z.string().url(),
  notes: z.string(),
  screenshot: imageReference,
  images: z.array(z.union([z.string().url(), assetReference])),
  captures: z.array(imageReference).default([]),
  previews: z.array(z.object({ url: z.union([z.string().url(), assetReference]), thumbnail: imageReference, original: assetReference.optional(), width: z.number().optional(), height: z.number().optional(), description: z.string().optional() })).default([]),
  selectedImages: z.array(z.union([z.string().url(), assetReference])).optional(),
});
export const modelSelectionSchema = z.object({
  analyze: z.string().max(200).default('latest:sonnet'), generate: z.string().max(200).default('latest:opus'), revise: z.string().max(200).default('latest:opus'),
  complete: z.string().max(200).default('latest:haiku'), rephrase: z.string().max(200).default('latest:sonnet'), chat: z.string().max(200).default('latest:sonnet'),
  agent: z.string().max(200).default('latest:sonnet'),
}).default({});
export type ModelAction = keyof z.infer<typeof modelSelectionSchema>;
export const writingMessageSchema = z.object({
  id: z.string(), role: z.enum(['user', 'assistant']), text: z.string(),
  suggestion: z.string().optional(), sourceBrief: z.string().optional(), model: z.string().optional(),
});
export const autocompleteUsageSchema = z.object({
  scope: z.string().default(''), requests: z.number().int().nonnegative().default(0),
  completed: z.number().int().nonnegative().default(0), failed: z.number().int().nonnegative().default(0), cancelled: z.number().int().nonnegative().default(0),
  inputTokens: z.number().nonnegative().default(0), outputTokens: z.number().nonnegative().default(0),
  cacheReadTokens: z.number().nonnegative().default(0), cacheWriteTokens: z.number().nonnegative().default(0),
  consecutiveFailures: z.number().int().nonnegative().default(0), unreported: z.number().int().nonnegative().default(0),
}).default({});
export type AutocompleteUsage = z.infer<typeof autocompleteUsageSchema>;
export const writingSchema = z.object({
  autocomplete: z.boolean().default(true), draft: z.string().default(''), messages: z.array(writingMessageSchema).max(40).default([]),
  usage: autocompleteUsageSchema,
}).default({ autocomplete: true, draft: '', messages: [] });
export type WritingMessage = z.infer<typeof writingMessageSchema>;
export const agentActionSchema = z.object({
  type: z.enum(['analyze', 'generate', 'revise', 'inspect', 'export', 'undo', 'redo', 'set_brief', 'move_earlier', 'move_later', 'duplicate', 'delete']),
  instruction: z.string(), url: z.string(), target: z.number().int().nonnegative().nullable(), referenceUrls: z.array(assetReference),
});
export type AgentAction = z.infer<typeof agentActionSchema>;
export const agentContextSchema = z.object({
  intent: z.enum(['chat', 'analyze', 'generate', 'revise']), target: z.number().int().nonnegative().nullable(), url: z.string().default(''),
});
export type AgentContext = z.infer<typeof agentContextSchema>;
export const agentMessageSchema = z.object({
  id: z.string(), role: z.enum(['user', 'assistant', 'tool']), text: z.string(), model: z.string().optional(),
  choices: z.array(z.object({ label: z.string(), message: z.string() })).optional(),
  context: agentContextSchema.optional(), attachments: z.array(revisionReferenceSchema).optional(),
  action: agentActionSchema.optional(), actionStatus: z.enum(['proposed', 'done', 'dismissed']).optional(), sourceKey: z.string().optional(),
  usage: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional(), modelMs: z.number().optional() }).optional(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export const agentStateSchema = z.object({
  draft: z.string().default(''), messages: z.array(agentMessageSchema).max(100).default([]),
  references: z.array(revisionReferenceSchema).max(MAX_REVISION_REFERENCES).default([]),
}).default({});
export const feedbackSchema = z.object({ categories: z.array(z.enum(['instructions', 'copy', 'layout'])), note: z.string(), updatedAt: z.string() });
export type RunFeedback = z.infer<typeof feedbackSchema>;
export const runSchema = z.object({
  operation: z.enum(['analyze', 'generate', 'revise', 'export', 'inspect']),
  id: z.string().optional(), requestedModel: z.string().optional(),
  steps: z.array(z.object({ message: z.string(), elapsedMs: z.number().nonnegative() })).optional(),
  inputs: z.object({ brief: z.string(), directions: z.array(slideDirectionSchema), website: z.string().nullable(), websiteNotes: z.string(), references: z.array(z.object({ url: z.string(), notes: z.string(), images: z.array(z.string()) })).optional(), revisionReferences: z.array(revisionReferenceSchema).optional(), images: z.array(z.string()), width: z.number(), height: z.number(), target: z.string() }).optional(),
  result: z.string().optional(),
  output: deckSchema.optional(), feedback: feedbackSchema.optional(),
  startedAt: z.string(), durationMs: z.number(), model: z.string().optional(),
  inputTokens: z.number().optional(), outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(), cacheWriteTokens: z.number().optional(),
  renderMs: z.number().optional(), modelMs: z.number().optional(), firstTokenMs: z.number().optional(), renderCacheHits: z.number().optional(),
  thinkingTokens: z.number().optional(), effort: z.string().optional(),
  instruction: z.string(), outcome: z.enum(['success', 'failed', 'cancelled']), message: z.string().optional(),
});
export const workspaceSchema = sizeSchema.extend({
  brief: z.string(),
  models: modelSelectionSchema,
  writing: writingSchema,
  agent: agentStateSchema,
  recentRuns: z.array(runSchema).max(10).default([]),
  slideDirectionsEnabled: z.boolean().default(false),
  slideDirections: z.array(slideDirectionDraftSchema).default([]),
  brand: brandSchema.nullable(),
  references: z.array(brandSchema).default([]),
  deck: deckSchema.nullable(),
  previous: z.object({ deck: deckSchema, instruction: z.string() }).nullable().default(null),
  redo: z.object({ deck: deckSchema, instruction: z.string() }).nullable().default(null),
  revisionText: z.string().default(''), revisionScope: z.enum(['slide', 'deck']).default('slide'), revisionTarget: z.number().int().nonnegative().default(0),
  revisionReferences: z.array(revisionReferenceSchema).max(MAX_REVISION_REFERENCES).default([]),
  lastInstruction: z.string().default(''),
  lastRun: runSchema.nullable().default(null),
});
export const generateSchema = workspaceSchema.extend({
  instruction: z.string().optional(),
  useUpdatedBrief: z.boolean().optional(),
  slideIndex: z.number().int().nonnegative().optional(),
  generationTask: z.string().optional(),
  generationReferences: z.array(revisionReferenceSchema).max(MAX_REVISION_REFERENCES).optional(),
});
export type SlideDirection = z.infer<typeof slideDirectionSchema>;
export type SlideDirectionDraft = z.infer<typeof slideDirectionDraftSchema>;
export type Deck = z.infer<typeof deckSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type GenerationInput = z.infer<typeof generateSchema>;
export type RunRecord = z.infer<typeof runSchema>;
export const emptyWorkspace: Workspace = { brief: '', models: modelSelectionSchema.parse(undefined), writing: writingSchema.parse(undefined), agent: agentStateSchema.parse(undefined), recentRuns: [], slideDirectionsEnabled: false, slideDirections: [], brand: null, references: [], deck: null, width: 1080, height: 1350, previous: null, redo: null, revisionText: '', revisionScope: 'slide', revisionTarget: 0, revisionReferences: [], lastInstruction: '', lastRun: null };
