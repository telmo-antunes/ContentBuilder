import { describe, expect, it } from 'vitest';
import { emptyWorkspace, kitSchema, type Deck, type Workspace } from './schema';
import { addSpend, callCost } from './pricing';
import { addProfile, brandList, removeProfile, switchProfile } from './profiles';
import { hasPost, postOf, summarize, withPost } from './drafts';
import { commitDeck, sameStacks, withoutStacks } from './history';
import { slideDocument } from './document';

const deck = (slides: string[]): Deck => ({ title: 'Deck', width: 1080, height: 1350, slides: slides.map(html => ({ html })) });
const asset = `/api/assets/${'a'.repeat(64)}.jpg`;

describe('what a post costs', () => {
  it('prices a call by model, counting cache reads and writes', () => {
    expect(callCost({ model: 'claude-opus-5-5', inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(6);
    expect(callCost({ model: 'claude-sonnet-5-5', cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 })).toBeCloseTo(0.2 + 2.5);
    expect(callCost({ model: 'claude-haiku-5-5', inputTokens: 10_000, outputTokens: 1000 })).toBeCloseTo(0.0015);
    expect(callCost({ model: 'some-other-model', inputTokens: 1000 })).toBeNull();
  });
  it('adds to this post and the running total, and ignores nothing spent', () => {
    const w = addSpend(addSpend(emptyWorkspace, 0.25), 0.5);
    expect(w.spend).toMatchObject({ post: 0.75, total: 0.75 });
    expect(w.spend.since).not.toBe('');
    expect(addSpend(w, undefined)).toBe(w);
  });
});

describe('brands', () => {
  it('switches brands without touching the post, and keeps each brand’s kit', () => {
    let w: Workspace = { ...emptyWorkspace, brief: 'My post', kit: kitSchema.parse({ handle: 'detailmasters' }) };
    w = addProfile(w);
    expect(w.kit.handle).toBe('');
    w = { ...w, kit: { ...w.kit, handle: 'apex' } };
    expect(brandList(w).map(item => item.name)).toEqual(['@apex', '@detailmasters']);
    const other = brandList(w).find(item => !item.active)!;
    w = switchProfile(w, other.id);
    expect(w.kit.handle).toBe('detailmasters');
    expect(w.brief).toBe('My post');
    expect(w.profiles.map(profile => profile.kit.handle)).toEqual(['apex']);
    w = removeProfile(w);
    expect(w.kit.handle).toBe('apex');
    expect(w.profiles).toEqual([]);
  });
});

describe('drafts', () => {
  it('sets a post aside and brings it back, keeping the brand and settings', () => {
    const post = postOf({ ...emptyWorkspace, brief: 'Saturday hours', deck: deck(['<p>Open</p>']), spend: { post: 0.4, total: 3, since: 'x' } });
    const other: Workspace = { ...emptyWorkspace, kit: kitSchema.parse({ handle: 'apex' }), polish: false, spend: { post: 0.1, total: 5, since: 'y' } };
    const back = withPost(other, post);
    expect(back.brief).toBe('Saturday hours');
    expect(back.kit.handle).toBe('apex');
    expect(back.polish).toBe(false);
    expect(back.spend).toEqual({ post: 0.4, total: 5, since: 'y' });
    expect(hasPost(back)).toBe(true);
    expect(summarize('id', 'now', post)).toMatchObject({ title: 'Deck', slides: 1, cover: { html: '<p>Open</p>' } });
    expect(summarize('id', 'now', postOf({ ...emptyWorkspace, brief: 'Only a brief\nmore' })).title).toBe('Only a brief');
  });
});

describe('saving less', () => {
  it('sees unchanged versions after ordinary edits, and changed ones after a commit', () => {
    const saved: Workspace = { ...emptyWorkspace, deck: deck(['one']) };
    const typing: Workspace = { ...saved, brief: 'typing' };
    expect(sameStacks(typing, saved)).toBe(true);
    expect(sameStacks(commitDeck(saved, deck(['two']), 'two'), saved)).toBe(false);
    expect(withoutStacks(commitDeck(saved, deck(['two']), 'two')).history).toEqual([]);
  });
});

describe('previews', () => {
  it('inlines each asset, whether the slide names it by its web URL (escaped or not) or by its saved path', () => {
    const data = 'data:image/jpeg;base64,eA==';
    const html = slideDocument(`<img src="https://example.com/photo.jpg?a=1&amp;b=2"><img src="${asset}">`, { 'https://example.com/photo.jpg?a=1&b=2': data, [asset]: data });
    expect(html.match(/src="[^"]+"/g)).toEqual([`src="${data}"`, `src="${data}"`]);
  });
});
