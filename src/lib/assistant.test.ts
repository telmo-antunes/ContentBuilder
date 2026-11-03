import { describe, expect, it, vi } from 'vitest';
vi.mock('./ai', () => ({ ask: vi.fn() }));
import { ask } from './ai';
import { assistWriting, decodeWritingReply, writingMessage, WRITING_OUTPUT_SCHEMA } from './assistant';
import { appendWritingMessage, canApplyWording, insertCompletion, writingContext, writingRequestSchema } from './writing';
import { emptyWorkspace, workspaceSchema } from './schema';

describe('writing assistance', () => {
  it('inserts a continuation at the original cursor without losing the suffix or accepting stale text', () => {
    expect(insertCompletion('Make  slides.', 'Make  slides.', 5, 'three')).toBe('Make three slides.');
    expect(insertCompletion('Make four slides.', 'Make  slides.', 5, 'three')).toBeNull();
    expect(insertCompletion('Short', 'Short', 10, 'more')).toBeNull();
    expect(canApplyWording('New wording', 'Old wording', 'Proposed')).toBe(false);
    expect(canApplyWording('', '', 'A new brief from the chat')).toBe(true);
  });
  it('sends unchanged instructions and only text website context, with correctly split cursor text', () => {
    const brief = '  Make slides.\nKeep “Exact copy”.';
    const workspace = { ...emptyWorkspace, brief, slideDirectionsEnabled: true, slideDirections: [{ id: '1', slide: 3, text: '  EXACT third slide.' }], brand: { url: 'https://example.com', notes: 'Inspiration', screenshot: 'data:image/jpeg;base64,unused', images: [], captures: [], previews: [] } };
    const input = writingRequestSchema.parse({ ...writingContext(workspace), mode: 'complete', cursor: 7 });
    const message = JSON.parse(writingMessage(input));
    expect(message.mainBrief).toBe(brief);
    expect(message.beforeCursor + message.afterCursor).toBe(brief);
    expect(message.slideDirections).toEqual([{ slide: 3, text: '  EXACT third slide.' }]);
    expect(message.websiteInspiration).toEqual({ url: 'https://example.com', notes: 'Inspiration' });
    expect(writingMessage(input)).not.toContain('data:image');
  });
  it('keeps bounded conversations and includes previous proposed briefs in chat context', () => {
    let messages = emptyWorkspace.writing.messages;
    for (let i = 0; i < 45; i++) messages = appendWritingMessage(messages, { id: String(i), role: i % 2 ? 'assistant' : 'user', text: `Message ${i}`, suggestion: i % 2 ? 'A proposed brief' : undefined });
    expect(messages).toHaveLength(40); expect(messages[0].id).toBe('5');
    const input = writingRequestSchema.parse({ ...writingContext(emptyWorkspace), mode: 'chat', cursor: 0, messages: messages.slice(-20) });
    expect(JSON.parse(writingMessage(input)).conversation).toHaveLength(20);
    expect(JSON.parse(writingMessage(input)).conversation[0].proposedBrief).toBe('A proposed brief');
  });
  it('rejects invalid cursor positions and malformed suggestions, allowing deliberate abstention', () => {
    expect(writingRequestSchema.safeParse({ ...writingContext(emptyWorkspace), mode: 'complete', cursor: 1 }).success).toBe(false);
    expect(decodeWritingReply('{"reply":"","suggestion":""}', 'complete')).toEqual({ reply: '', suggestion: '' });
    expect(() => decodeWritingReply('not JSON', 'rephrase')).toThrow('unreadable');
    expect(() => decodeWritingReply('{"reply":"","suggestion":"A brief"}', 'chat')).toThrow('incomplete');
    expect(() => decodeWritingReply(JSON.stringify({ reply: '', suggestion: 'x'.repeat(401) }), 'complete')).toThrow('incomplete');
    expect(() => decodeWritingReply('{"reply":"Fixed a typo","suggestion":"Fixed a typo"}', 'rephrase', 'Keep the exact headline “Water less, observe more.”')).toThrow('left out quoted wording');
    expect(decodeWritingReply('{"reply":"Fixed a typo","suggestion":"Use the headline: Water less, observe more."}', 'rephrase', 'Use teh headline “Water less, observe more.”').suggestion).toContain('Water less, observe more.');
  });
  it('uses the action’s selected model, small output budget and text-only structured response', async () => {
    vi.mocked(ask).mockResolvedValue('{"reply":"Who is this for?","suggestion":""}');
    const operation = { signal: new AbortController().signal, progress: vi.fn(), usage: vi.fn() };
    const input = writingRequestSchema.parse({ ...writingContext(emptyWorkspace), mode: 'chat', model: 'chat-choice', cursor: 0, messages: [{ id: 'one', role: 'user', text: 'Help me decide the audience.' }] });
    expect(await assistWriting(input, operation)).toEqual({ reply: 'Who is this for?', suggestion: '' });
    expect(ask).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), operation, true, 'chat-choice', expect.objectContaining({ schema: WRITING_OUTPUT_SCHEMA, vision: false, maxTokens: 4096 }));
    vi.mocked(ask).mockResolvedValue('{"reply":"","suggestion":" for beginners."}');
    await assistWriting({ ...input, mode: 'complete', model: 'completion-choice' }, operation);
    expect(ask).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), operation, true, 'completion-choice', expect.objectContaining({ maxTokens: 400, timeoutMs: 20_000 }));
  });
  it('migrates older drafts without changing existing model selections or the brief', () => {
    const { writing, ...legacy } = emptyWorkspace;
    const restored = workspaceSchema.parse({ ...legacy, brief: 'My untouched description', models: { analyze: 'analysis', generate: 'generation', revise: 'revision' } });
    expect(restored.brief).toBe('My untouched description');
    expect(restored.models).toEqual({ ...emptyWorkspace.models, analyze: 'analysis', generate: 'generation', revise: 'revision' });
    expect(restored.writing).toEqual(emptyWorkspace.writing);
  });
});
