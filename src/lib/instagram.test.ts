import { describe, expect, it } from 'vitest';
import { decodeDeck, generationMessage, parseTagged, slideStreamer, DESIGN_PROMPT, brandKitText } from './ai';
import { emptyWorkspace, kitSchema, type Deck, type Workspace } from './schema';
import { commitDeck, findVersion, travel, undoStack, versions } from './history';
import { parseCanvas, viewingNotes } from './formats';
import { addLesson, isQuestion, looksLikeCreate, seedKit } from './kit';
import { fontStylesheets } from './fonts';
import { validateAgentAction } from './agent-state';
import { captionText } from './caption';

const tagged = `<deck mode="full" title="Três sinais">
<slide n="1" alt="Capa com o título">
<!doctype html><html><body><table><caption>not the post caption</caption></table>Capa</body></html>
</slide>
<slide n="2" alt="Sinal um">
<!doctype html><html><body>Um</body></html>
</slide>
<caption>Linha de abertura.

Mais detalhe.</caption>
<hashtags>#detailing #ceramica</hashtags>
<first-comment>Link na bio</first-comment>
</deck>`;
const deck = (slides: string[]): Deck => ({ title: 'Deck', width: 1080, height: 1350, slides: slides.map(html => ({ html })) });

describe('the tagged slide format', () => {
  it('reads slides, alt text and the caption, ignoring caption tags inside a slide', () => {
    const output = parseTagged(tagged)!;
    expect(output.mode).toBe('full');
    expect(output.title).toBe('Três sinais');
    expect(output.slides.map(slide => slide.alt)).toEqual(['Capa com o título', 'Sinal um']);
    expect(output.slides[0].html).toContain('<caption>not the post caption</caption>');
    expect(output.caption).toEqual({ text: 'Linha de abertura.\n\nMais detalhe.', hashtags: '#detailing #ceramica', firstComment: 'Link na bio' });
  });
  it('streams each slide once, as soon as it closes', () => {
    const seen: number[] = [];
    const feed = slideStreamer(slide => seen.push(slide.n));
    const cut = tagged.indexOf('</slide>') + 4;
    feed(tagged.slice(0, cut)); expect(seen).toEqual([]);
    feed(tagged.slice(0, cut + 10)); expect(seen).toEqual([1]);
    feed(tagged); feed(tagged); expect(seen).toEqual([1, 2]);
  });
  it('builds a new deck with caption and alt text', () => {
    const result = decodeDeck(tagged, { ...emptyWorkspace, brief: 'Três sinais' });
    expect(result.slides).toHaveLength(2);
    expect(result.slides[1]).toMatchObject({ alt: 'Sinal um' });
    expect(result.caption?.hashtags).toBe('#detailing #ceramica');
    expect(captionText(result)).toContain('Alt text:\n1. Capa com o título');
  });
  it('applies a whole-deck patch to the changed slides only and keeps the caption', () => {
    const current = { ...deck(['one', 'two', 'three']), caption: { text: 'Keep me', hashtags: '', firstComment: '' } };
    const input = { ...emptyWorkspace, brief: 'b', deck: current, instruction: 'Fix slide 2' };
    const result = decodeDeck('<deck mode="patch">\n<slide n="2">\nTWO\n</slide>\n</deck>', input);
    expect(result.slides.map(slide => slide.html)).toEqual(['one', 'TWO', 'three']);
    expect(result.caption?.text).toBe('Keep me');
    expect(decodeDeck('<deck mode="patch"></deck>', input).slides.map(slide => slide.html)).toEqual(['one', 'two', 'three']);
  });
  it('replaces the whole deck when a full revision changes the slide count', () => {
    const input = { ...emptyWorkspace, brief: 'b', deck: deck(['one', 'two']), instruction: 'Merge into one slide' };
    expect(decodeDeck('<deck mode="full" title="Merged">\n<slide n="1">\nONE\n</slide>\n</deck>', input).slides.map(slide => slide.html)).toEqual(['ONE']);
  });
  it('revises one slide from a patch', () => {
    const input = { ...emptyWorkspace, brief: 'b', deck: deck(['one', 'two']), instruction: 'Shorter', slideIndex: 1 };
    expect(decodeDeck('<deck mode="patch"><slide n="2">short</slide></deck>', input).slides.map(slide => slide.html)).toEqual(['one', 'short']);
  });
  it('still reads the older JSON envelope', () => {
    expect(decodeDeck('{"title":"Old","slides":[{"html":"a"}]}', { ...emptyWorkspace, brief: 'b' }).slides[0].html).toBe('a');
  });
});

describe('Instagram context for the designer', () => {
  it('tells the designer how the format is seen, without templates', () => {
    expect(DESIGN_PROMPT).toContain('roughly a third of its pixel size');
    expect(DESIGN_PROMPT).toContain('keeping European and Brazilian Portuguese distinct');
    expect(viewingNotes({ width: 1080, height: 1920 })).toMatch(/story.*top 250 px.*bottom 346 px/s);
    expect(viewingNotes({ width: 1080, height: 1350 })).toContain('3:4');
    const text = JSON.stringify(generationMessage({ ...emptyWorkspace, brief: 'b', width: 1080, height: 1920 }));
    expect(text).toContain('FORMAT: Instagram story');
  });
  it('sends the brand kit, lessons, article and pinned inspiration', () => {
    const kit = kitSchema.parse({ handle: '@detailmasters', voice: 'Calm', colors: ['#111111'], lessons: ['Never say barato'] });
    expect(brandKitText(kit)).toContain('@detailmasters');
    const brand = { url: 'https://example.com', notes: 'n', screenshot: 'data:image/jpeg;base64,eA==', captures: [], previews: [], images: [], article: { title: 'How often to reapply', text: 'Every two years.' } };
    const pinned = [{ name: 'love.jpg', original: `/api/assets/${'a'.repeat(64)}.jpg`, preview: `/api/assets/${'b'.repeat(64)}.jpg`, thumbnail: `/api/assets/${'c'.repeat(64)}.jpg`, width: 10, height: 10 }];
    const text = JSON.stringify(generationMessage({ ...emptyWorkspace, brief: 'b', kit, brand, pinned }, { pinned: [{ label: 'PINNED 1 — love.jpg', data: 'data:image/jpeg;base64,eA==' }] }));
    expect(text).toContain('Never say barato');
    expect(text).toContain('ARTICLE FROM https://example.com');
    expect(text).toContain('STANDING INSPIRATION');
  });
  it('re-flows the current deck into a new format', () => {
    const text = JSON.stringify(generationMessage({ ...emptyWorkspace, brief: 'b', width: 1080, height: 1920, deck: deck(['carousel slide']), remix: true }));
    expect(text).toContain('SOURCE DECK (1080 × 1350)');
    expect(text).toContain('CANVAS: 1080 × 1920');
  });
});

describe('versions', () => {
  const start: Workspace = { ...emptyWorkspace, deck: deck(['v1']), lastInstruction: 'first' };
  it('keeps many versions and walks back and forward', () => {
    let w = commitDeck(start, deck(['v2']), 'second');
    w = commitDeck(w, deck(['v3']), 'third');
    expect(undoStack(w)).toHaveLength(2);
    expect(w.previous?.deck.slides[0].html).toBe('v2');
    w = travel(w, 'undo', 2);
    expect(w.deck?.slides[0].html).toBe('v1');
    expect(w.future).toHaveLength(2);
    expect(versions(w).map(item => item.version.deck.slides[0].html)).toEqual(['v3', 'v2', 'v1']);
    w = travel(w, 'redo');
    expect(w.deck?.slides[0].html).toBe('v2');
  });
  it('gives every committed version an id the conversation can point at', () => {
    let w = commitDeck(start, deck(['v2']), 'second');
    const v2 = w.deck!.id!;
    w = commitDeck(w, deck(['v3']), 'third');
    expect(w.deck!.id).not.toBe(v2);
    expect(findVersion(w, v2)).toMatchObject({ direction: 'undo', steps: 1 });
    expect(travel(w, 'undo').deck!.id).toBe(v2);
  });
  it('reads an older single previous version as a one-entry stack', () => {
    const legacy = { ...start, previous: { deck: deck(['old']), instruction: '' } };
    expect(travel(legacy, 'undo').deck?.slides[0].html).toBe('old');
  });
});

describe('small helpers', () => {
  it('parses formats', () => {
    expect(parseCanvas('a story version')).toEqual({ width: 1080, height: 1920 });
    expect(parseCanvas('square')).toEqual({ width: 1080, height: 1080 });
    expect(parseCanvas('1200x1500')).toEqual({ width: 1200, height: 1500 });
    expect(parseCanvas('bigger')).toBeNull();
    expect(validateAgentAction({ type: 'set_canvas', instruction: 'bigger', url: '', target: null, referenceUrls: [] }, emptyWorkspace)).toContain('Name a format');
  });
  it('seeds only empty kit fields and keeps lessons unique', () => {
    const kit = kitSchema.parse({ voice: 'Mine' });
    const seeded = seedKit(kit, { voice: 'Theirs', handle: 'dm', colors: ['#000'] });
    expect(seeded).toMatchObject({ voice: 'Mine', handle: 'dm', colors: ['#000'] });
    expect(addLesson(addLesson(kit, 'Use short headlines'), 'use short headlines').lessons).toHaveLength(1);
  });
  it('sends plain post requests straight to generation and questions to the agent', () => {
    expect(looksLikeCreate('5-slide carousel on the mistakes that cost studios regulars')).toBe(true);
    expect(looksLikeCreate('Which slide is weakest?')).toBe(false);
    expect(looksLikeCreate('Como posso melhorar o slide 2')).toBe(false);
    expect(looksLikeCreate('ceramic coatings')).toBe(false);
    expect(isQuestion('Porque é que este slide está fraco?')).toBe(true);
    expect(isQuestion('Título mais curto, no máximo quatro palavras.')).toBe(false);
  });
  it('finds Google Fonts stylesheets, including escaped ones', () => {
    const fonts = fontStylesheets(deck(['<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@700&amp;display=swap" rel="stylesheet">']));
    expect(fonts).toEqual(['https://fonts.googleapis.com/css2?family=Poppins:wght@700&display=swap']);
  });
});
