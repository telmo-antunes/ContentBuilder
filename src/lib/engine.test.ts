import { describe, expect, it } from 'vitest';
import { decodeDeck, generationMessage, DESIGN_PROMPT, DECK_OUTPUT_SCHEMA } from './ai';
import { slideDocument } from './document';
import { emptyWorkspace } from './schema';
import { isPrivateAddress, publicUrl } from './browser';

describe('direct generation', () => {
  const brief = 'Make 2 slides. Slide 1: "KEEP every word!" Tiny purple type. Slide 2: an asymmetric SVG diagram; ignore the website colors.';
  const input = { ...emptyWorkspace, brief };
  it('passes the complete brief directly, without a copy parser or recipe', () => {
    const blocks = generationMessage(input);
    expect(JSON.stringify(blocks)).toContain(brief.replaceAll('"', '\\"'));
    expect(DESIGN_PROMPT).toContain('The user can override every aspect of it.');
  });
  it('preserves arbitrary CSS, SVG, small type and exact copy in the model output', () => {
    const html = '<style>.my-layout{display:grid;grid-template-columns:3fr 1fr;color:#b201ff;font-size:8px}</style><div class="my-layout">KEEP every word!<svg><circle r="20" /></svg></div>';
    const result = decodeDeck(JSON.stringify({ title: 'Custom', slides: [{ html }] }), input);
    expect(result.slides[0].html).toBe(html);
    const render = slideDocument(html);
    expect(render).toContain('grid-template-columns:3fr 1fr;color:#b201ff;font-size:8px');
    expect(render).toContain('KEEP every word!');
    expect(render).toContain('<circle r="20">');
  });
  it('revises one slide and leaves the rest of the deck and its dimensions untouched', () => {
    const deck = { title: 'Original', width: 1200, height: 900, slides: [{ html: 'first' }, { html: 'second' }, { html: 'third' }] };
    const result = decodeDeck('{"title":"different","slides":[{"html":"new second"}]}', { ...input, deck, instruction: 'Change slide 2', slideIndex: 1 });
    expect(result).toEqual({ ...deck, originBrief: brief, originSlideDirections: [], assets: {}, slides: [deck.slides[0], { html: 'new second' }, deck.slides[2]] });
    expect(result.slides[0]).toBe(deck.slides[0]);
    expect(result.slides[2]).toBe(deck.slides[2]);
  });
  it('keeps the generating brief during revision unless explicitly replaced', () => {
    const deck = { width: 600, height: 750, title: 'Deck', originBrief: 'Original exact wording', slides: [{ html: 'Original exact wording' }] };
    const revision = { ...input, brief: 'Unrelated new idea', deck, instruction: 'Move the text' };
    expect(JSON.stringify(generationMessage(revision))).toContain('Original exact wording');
    expect(JSON.stringify(generationMessage(revision))).not.toContain('Unrelated new idea');
    const response = JSON.stringify({ title: 'Deck', slides: [{ html: 'Original exact wording' }] });
    expect(decodeDeck(response, revision).originBrief).toBe(deck.originBrief);
    expect(decodeDeck(response, { ...revision, useUpdatedBrief: true }).originBrief).toBe(revision.brief);
    expect(JSON.stringify(generationMessage({ ...revision, useUpdatedBrief: true }))).toContain('Unrelated new idea');
  });
  it('fails visibly instead of substituting templates when output is malformed', () => {
    expect(() => decodeDeck('not json', input)).toThrow('invalid slide JSON');
    expect(() => decodeDeck('{"title":"empty","slides":[]}', input)).toThrow('incomplete deck');
  });
  it('keeps the structured envelope free of design constraints', () => {
    expect(DECK_OUTPUT_SCHEMA.properties.slides.items.properties).toEqual({ html: { type: 'string' } });
    expect(DECK_OUTPUT_SCHEMA.properties.slides).not.toHaveProperty('maxItems');
  });
  it('sends only selected asset URLs and includes the current rendered slide', () => {
    const brand = { url: 'https://example.com', notes: 'Reference', screenshot: 'data:image/jpeg;base64,d2Vic2l0ZQ==', captures: [], previews: [],
      images: ['https://example.com/keep.jpg', 'https://example.com/exclude.jpg'], selectedImages: ['https://example.com/keep.jpg'] };
    const deck = { width: 600, height: 750, title: 'Deck', slides: [{ html: 'Original words' }] };
    const blocks = generationMessage({ ...input, brand, deck, instruction: 'Move the headline', slideIndex: 0 }, [], [{ label: 'Slide 1', data: 'data:image/jpeg;base64,cmVuZGVy' }]);
    const json = JSON.stringify(blocks);
    expect(json).toContain('keep.jpg'); expect(json).not.toContain('exclude.jpg');
    expect(json).toContain('CURRENT RENDER'); expect(json).toContain('cmVuZGVy'); expect(json).toContain('Original words');
    expect(blocks.some(block => 'cache_control' in block)).toBe(true);
  });
});

describe('render isolation', () => {
  it('removes executable content and navigation without changing design CSS', () => {
    const output = slideDocument('<meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script><iframe src="https://example.com"></iframe><div onclick="alert(1)" style="position:absolute;left:21px">Hello</div><style>@import url("https://fonts.googleapis.com/css2?family=Inter");.x{color:red!important}</style>');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('<iframe');
    expect(output).not.toContain('onclick');
    expect(output).not.toContain('http-equiv="refresh"');
    expect(output).toContain('position:absolute;left:21px');
    expect(output).toContain('.x{color:red!important}');
    expect(output).toContain("script-src 'none'");
    expect(output).toContain('https://fonts.googleapis.com');
  });
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fd00::1'])('blocks private address %s', address => {
    expect(isPrivateAddress(address)).toBe(true);
  });
  it('rejects file and local URLs', async () => {
    await expect(publicUrl('file:///etc/passwd')).rejects.toThrow('public HTTP');
    await expect(publicUrl('http://127.0.0.1')).rejects.toThrow('public website');
    await expect(publicUrl('http://[::1]')).rejects.toThrow('public website');
  });
});
