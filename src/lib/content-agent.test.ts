import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('./ai', () => ({ ask: vi.fn() }));
vi.mock('./render', () => ({ revisionImages: vi.fn(async (_deck, index) => [{ label: index === undefined ? 'Whole deck' : `Selected slide ${index + 1}`, data: 'data:image/jpeg;base64,c2xpZGU=' }]) }));
vi.mock('./assets', () => ({ imageData: vi.fn(async () => 'data:image/jpeg;base64,cmVmZXJlbmNl') }));
import { ask } from './ai';
import { contentAgent, agentRequestSchema } from './content-agent';
import { agentContextKey, agentReferences, appendAgentMessage, requiresProposal, validateAgentAction } from './agent-state';
import { emptyWorkspace, workspaceSchema, type AgentAction, type Workspace } from './schema';

const action = (type: AgentAction['type'], patch: Partial<AgentAction> = {}): AgentAction => ({ type, instruction: 'Keep the exact copy; increase the spacing.', target: null, url: '', referenceUrls: [], ...patch });
const image = { name: 'reference.png', original: `/api/assets/${'a'.repeat(64)}.png`, preview: `/api/assets/${'b'.repeat(64)}.jpg`, thumbnail: `/api/assets/${'c'.repeat(64)}.jpg`, width: 600, height: 750 };
const workspace: Workspace = { ...emptyWorkspace, brief: 'Main brief verbatim.', slideDirectionsEnabled: true, slideDirections: [{ id: 'two', slide: 2, text: 'EXACT second-slide instruction.' }], deck: { title: 'Test', width: 600, height: 750, slides: [{ html: '<p>One</p>', renderedText: 'One' }, { html: '<p>Two</p>', renderedText: 'Two' }] }, agent: { ...emptyWorkspace.agent, messages: [{ id: 'u', role: 'user', text: 'Make this less crowded.', context: { intent: 'revise', target: 1, url: '' }, attachments: [image] }] } };
const operation = () => ({ signal: new AbortController().signal, progress: vi.fn(), usage: vi.fn() });

describe('content agent safeguards and context', () => {
  beforeEach(() => vi.clearAllMocks());
  it('requires a proposal for every slide or brief mutation, including clear requests and undo', () => {
    for (const type of ['generate','revise','set_brief','undo','redo','delete','duplicate','move_earlier','move_later'] as const) expect(requiresProposal(action(type))).toBe(true);
    for (const type of ['analyze','inspect','export'] as const) expect(requiresProposal(action(type))).toBe(false);
  });
  it('rejects invalid slide operations and unavailable reference images', () => {
    expect(validateAgentAction(action('revise', { target: 2 }), workspace)).toContain('no longer available');
    expect(validateAgentAction(action('delete', { target: 0 }), { ...workspace, deck: { ...workspace.deck!, slides: [workspace.deck!.slides[0]] } })).toContain('at least one');
    expect(validateAgentAction(action('move_earlier', { target: 0 }), workspace)).toContain('edge');
    expect(validateAgentAction(action('undo'), workspace)).toContain('no earlier');
    expect(validateAgentAction(action('revise', { referenceUrls: ['/api/assets/missing.png'] }), workspace)).toContain('no longer available');
    expect(validateAgentAction(action('revise', { target: 1, referenceUrls: [image.original] }), workspace)).toBeNull();
  });
  it('invalidates proposals when deck, instructions, scope or models change, but not when a reply is appended', () => {
    const key = agentContextKey(workspace, 1);
    for (const changed of [{ ...workspace, brief: 'Edited brief' }, { ...workspace, models: { ...workspace.models, revise: 'latest:haiku' } }, { ...workspace, deck: { ...workspace.deck!, title: 'New deck' } }]) expect(agentContextKey(changed, 1)).not.toBe(key);
    expect(agentContextKey(workspace, 0)).not.toBe(key);
    expect(agentContextKey({ ...workspace, agent: { ...workspace.agent, draft: 'Still typing', messages: [...workspace.agent.messages, { id: 'a', role: 'assistant', text: 'Proposed change.' }] } }, 1)).toBe(key);
  });
  it('migrates legacy workspaces without touching existing instructions or models', () => {
    const { agent: _agent, ...legacy } = workspace;
    const restored = workspaceSchema.parse(legacy);
    expect(restored.agent).toEqual({ draft: '', messages: [], references: [] });
    expect(restored.brief).toBe(workspace.brief); expect(restored.slideDirections).toEqual(workspace.slideDirections);
    expect(restored.models.agent).toBe('latest:sonnet');
  });
  it('bounds conversation and deduplicates references without losing attachments to recent messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({ id: String(i), role: 'user' as const, text: String(i) }));
    expect(appendAgentMessage(messages, { id: 'new', role: 'assistant', text: 'reply' })).toHaveLength(100);
    expect(agentReferences({ ...workspace, revisionReferences: [image], agent: { ...workspace.agent, references: [image] } })).toEqual([image]);
  });
  it('passes exact instructions, prior answers, the selected slide, cached renders and uploads to the chosen agent model', async () => {
    vi.mocked(ask).mockResolvedValue(JSON.stringify({ reply: 'I can space slide 2 more generously.', choices: [], action: action('revise', { target: 1, referenceUrls: [image.original] }) }));
    const input = agentRequestSchema.parse({ workspace, selectedSlide: 1 }); const op = operation();
    const reply = await contentAgent(input, op);
    expect(reply.action?.target).toBe(1);
    const [prompt, content, , , model] = vi.mocked(ask).mock.calls[0];
    expect(model).toBe('latest:sonnet'); expect(prompt).toContain('proposal');
    const serialized = JSON.stringify(content);
    expect(serialized).toContain(workspace.brief); expect(serialized).toContain('EXACT second-slide instruction.');
    expect(serialized).toMatch(/selectedSlide\\":1/); expect(serialized).toContain(image.original); expect(serialized).toContain('cmVmZXJlbmNl');
    // The deck renders lead the message and end in a cache breakpoint, so unchanged decks are read from the prompt cache.
    const blocks = content as { type: string; cache_control?: unknown }[];
    expect(blocks[1]).toMatchObject({ type: 'image', cache_control: { type: 'ephemeral' } });
    expect(blocks.filter(block => block.type === 'image')).toHaveLength(2);
    expect(workspace.deck!.slides[1].html).toBe('<p>Two</p>');
  });
  it('questions and choices stop execution even if the model also supplies an action', async () => {
    vi.mocked(ask).mockResolvedValue(JSON.stringify({ reply: 'Keep all copy?', choices: [{ label: 'Keep it all', message: 'Keep all the wording.' }], action: action('revise') }));
    const reply = await contentAgent({ workspace, selectedSlide: 1 }, operation());
    expect(reply.action).toBeNull(); expect(reply.choices).toHaveLength(1);
  });
  it('rejects malformed or out-of-range actions visibly', async () => {
    vi.mocked(ask).mockResolvedValue('not json');
    await expect(contentAgent({ workspace, selectedSlide: 1 }, operation())).rejects.toThrow('unreadable');
    vi.mocked(ask).mockResolvedValue(JSON.stringify({ reply: 'Change slide 9', choices: [], action: action('revise', { target: 8 }) }));
    await expect(contentAgent({ workspace, selectedSlide: 1 }, operation())).rejects.toThrow('no longer available');
  });
});
