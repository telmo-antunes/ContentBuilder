import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parse } from 'parse5';

// Explicitly invoked only. This uses the configured paid model, never autosave.
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const name = option('--name'); const compare = option('--compare'); const replay = option('--replay');
if (!name || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(name) || ([compare, replay].some(value => value && !/^[a-z0-9][a-z0-9-]{0,60}$/.test(value)))) {
  console.log('Usage: npm run benchmark -- --name baseline [--compare earlier-run] [--case exact-copy] [--replay earlier-run]\nUses the configured model. Results stay in .data/benchmarks; the workspace is never saved.'); process.exit(1);
}
if (option('--case') && !['exact-copy', 'unusual-layout', 'website-override', 'narrow-revision', 'deck-revision', 'dense-copy'].includes(option('--case'))) throw new Error('Unknown benchmark case.');
const base = 'http://127.0.0.1:3000';
await mkdir(resolve('.data/benchmarks'), { recursive: true });
const directory = resolve('.data/benchmarks', name); await mkdir(directory, { recursive: false });
const previous = compare ? JSON.parse(await readFile(resolve('.data/benchmarks', compare, 'results.json'), 'utf8')) : null;
const replaySource = replay ? JSON.parse(await readFile(resolve('.data/benchmarks', replay, 'results.json'), 'utf8')) : null;
const fixture = { width: 600, height: 750, title: 'Revision fixture', originBrief: 'Two slides. First says ORIGINAL ONE on purple. Second says ORIGINAL TWO on yellow. Keep this exact wording.', slides: [
  { html: '<style>body{background:#8000ff;color:white;display:grid;place-items:center;font:36px Georgia}</style><p>ORIGINAL ONE</p>' },
  { html: '<style>body{background:#ffe000;color:#111;display:grid;place-items:center;font:36px Georgia}</style><p>ORIGINAL TWO</p>' },
] };
const cases = [
  { id: 'exact-copy', brief: 'Create exactly 2 slides. Slide 1 must say only “Small steps. Real progress.” Slide 2 must say only “Keep every word — even this dash.” Use large legible type and restrained composition.', count: 2, exact: ['Small steps. Real progress.', 'Keep every word — even this dash.'], judge: 'Are all words preserved, readable, and composed with intent?' },
  { id: 'unusual-layout', brief: 'One slide. A deliberately asymmetric editorial composition: the word ORBIT runs vertically along the left edge, a huge coral circle is cropped by the right edge, and three small captions read north, east, and beyond. Warm ivory background. No cards. Use HTML/CSS and inline SVG only.', count: 1, exact: ['ORBIT', 'north', 'east', 'beyond'], judge: 'Does the unusual composition follow the spatial instructions? Are intentional crops preserved?' },
  { id: 'website-override', brief: 'One slide reading “Break the pattern.” Ignore the reference colors and typography completely. Use a neon-lime background, black monospace lettering and an angular composition. No images.', count: 1, exact: ['Break the pattern.'], reference: true, judge: 'Did explicit directions override the warm burgundy serif website reference?' },
  { id: 'narrow-revision', brief: 'Unrelated edited brief: turn this into a blue sales deck.', deck: fixture, instruction: 'On slide 2 only, move ORIGINAL TWO into the bottom-right corner with a 40px inset. Preserve its words, color, size and yellow background.', slideIndex: 1, count: 2, exact: ['ORIGINAL ONE', 'ORIGINAL TWO'], judge: 'Did only the requested placement change? Was slide 1 left byte-for-byte unchanged? Was the unrelated edited brief ignored?' },
  { id: 'deck-revision', brief: fixture.originBrief, deck: fixture, instruction: 'Change both slide backgrounds to dark navy and their text to warm ivory. Preserve exact wording, slide count, type size and centered positioning.', count: 2, exact: ['ORIGINAL ONE', 'ORIGINAL TWO'], judge: 'Did both slides change consistently while preserving the requested details?' },
  { id: 'dense-copy', brief: 'One slide. Preserve this paragraph exactly and make it comfortably readable: “We make tools for people who care about their work. Every detail should earn its place. Start with a clear idea, give it room, and keep refining until the result says what you mean.” Include the headline “Care shows.” Build a calm, thoughtful layout. Use only HTML/CSS; no remote assets.', count: 1, exact: ['Care shows.', 'We make tools for people who care about their work. Every detail should earn its place. Start with a clear idea, give it room, and keep refining until the result says what you mean.'], judge: 'Is the copy exact and readable, with hierarchy and comfortable spacing?' },
];
function visibleText(html) {
  const visit = node => ['style','script','head'].includes(node.tagName) ? '' : node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(visit).join(' ');
  return visit(parse(html)).replace(/\s+/g, ' ').trim();
}
async function request(path, body) {
  const response = await fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response;
}
async function generate(input, path = 'generate') {
  const start = Date.now(); const response = await request(path, input); let result; let usage = {}; let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }); let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === 'progress') console.log(`  ${event.message}`);
      if (event.type === 'usage') usage = { ...usage, ...event.usage, renderMs: (usage.renderMs ?? 0) + (event.usage.renderMs ?? 0), renderCacheHits: (usage.renderCacheHits ?? 0) + (event.usage.renderCacheHits ?? 0) };
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'result') result = event.value;
    }
  }
  if (!result) throw new Error('No completed result');
  return { deck: result, usage, durationMs: Date.now() - start };
}
const results = { name, replayedFrom: replay ?? null, createdAt: new Date().toISOString(), cases: [] };
for (const item of cases.filter(item => !option('--case') || item.id === option('--case'))) {
  console.log(item.id);
  try {
    let brand = null;
    if (item.reference && !replay) {
      // Deterministic synthetic website evidence, independent of network changes.
      const puppeteer = (await import('puppeteer')).default; const browser = await puppeteer.launch({ headless: true });
      try {
        const page = await browser.newPage(); await page.setViewport({ width: 900, height: 600 });
        await page.setContent('<body style="background:#641f34;color:#f4e8d4;font:40px Georgia;padding:80px"><h1>Quiet & Co.</h1><p>Thoughtful objects for everyday rituals.</p>');
        brand = { url: 'https://example.com', notes: 'Synthetic benchmark reference: burgundy and cream, traditional serif type, quiet luxury. Inspiration only.', screenshot: `data:image/jpeg;base64,${Buffer.from(await page.screenshot({ type: 'jpeg' })).toString('base64')}`, images: [], captures: [], previews: [] };
      } finally { await browser.close(); }
    }
    const result = replay ? await generate(replaySource.cases.find(c => c.id === item.id)?.deck ?? (() => { throw new Error('Missing replay deck'); })(), 'inspect') : await generate({ width: 600, height: 750, brief: item.brief, brand, deck: item.deck ?? null, instruction: item.instruction, slideIndex: item.slideIndex });
    const text = result.deck.slides.map(slide => (slide.renderedText ?? visibleText(slide.html))).join(' ');
    const checks = { slideCount: result.deck.slides.length === item.count, exactCopy: item.exact.every(copy => ['exact-copy', 'dense-copy'].includes(item.id) ? text.includes(copy) : text.toLocaleLowerCase().includes(copy.toLocaleLowerCase())), ...(item.slideIndex !== undefined ? { untouchedSlide: result.deck.slides[0].html === fixture.slides[0].html } : {}) };
    const images = [];
    for (let i = 0; i < result.deck.slides.length; i++) {
      const response = await request(`export?slide=${i}`, result.deck); const filename = `${item.id}-${i + 1}.png`;
      await writeFile(join(directory, filename), Buffer.from(await response.arrayBuffer())); images.push(filename);
    }
    results.cases.push({ id: item.id, brief: item.brief, instruction: item.instruction, judge: item.judge, ...result, checks, images, humanRating: 'unreviewed' });
  } catch (error) { results.cases.push({ id: item.id, error: error.message, humanRating: 'unreviewed' }); }
  await writeFile(join(directory, 'results.json'), JSON.stringify(results, null, 2));
}
if (!results.cases.length) throw new Error('Unknown --case. Use exact-copy, unusual-layout, website-override, narrow-revision, deck-revision, or dense-copy.');
const escape = text => String(text ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const pictures = (item, prefix = '') => item?.images?.map(image => `<img src="${escape(prefix + image)}" alt="${escape(item.id)}">`).join('') ?? '<p>No render available.</p>';
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ContentBuilder benchmark ${escape(name)}</title><style>body{font:16px/1.6 system-ui;margin:32px;background:#f6f3eb;color:#24211a}main{max-width:1200px;margin:auto}section{border-top:1px solid #aaa;padding:24px 0}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}img{width:100%;max-width:330px;vertical-align:top;margin:8px 8px 8px 0}textarea{width:95%;min-height:80px;font:inherit}button,select{font:inherit;padding:10px}pre{white-space:pre-wrap}label{display:block;margin-top:16px}</style><main><h1>${escape(name)}${compare ? ` compared with ${escape(compare)}` : ''}</h1><p>${replay ? `Replayed saved HTML from ${escape(replay)}; no model calls were made. ` : ''}Mechanical checks verify count and requested rendered text. Exact-copy and dense-copy are case-sensitive; other cases allow typographic case changes. Human judgment remains unreviewed until you record it. This report does not change engine prompts.</p>${results.cases.map(item => `<section data-case="${escape(item.id)}"><h2>${escape(item.id)}</h2><p>${escape(item.judge)}</p><details><summary>Directions and measurements</summary><pre>${escape(JSON.stringify({ brief:item.brief,instruction:item.instruction,checks:item.checks,usage:item.usage,durationMs:item.durationMs,error:item.error },null,2))}</pre></details><div class="pair">${compare ? `<div><h3>${escape(compare)}</h3>${pictures(previous.cases.find(old => old.id === item.id), `../${compare}/`)}</div>` : ''}<div><h3>${escape(name)}</h3>${pictures(item)}</div></div><label>Human judgment <select><option>unreviewed</option><option>follows instructions; quality acceptable</option><option>needs improvement</option><option>fails instructions</option></select></label><label>Notes<textarea placeholder="Describe the specific strength, regression, or mismatch."></textarea></label></section>`).join('')}<button id="save">Download judgments</button><p>Download judgments to keep your assessment with results.json before changing prompts.</p></main><script>const key=${JSON.stringify(`contentbuilder-benchmark-${name}`)};try{const saved=JSON.parse(localStorage.getItem(key)||'{}');document.querySelectorAll('section').forEach(s=>{if(saved[s.dataset.case]){s.querySelector('select').value=saved[s.dataset.case].rating;s.querySelector('textarea').value=saved[s.dataset.case].notes}})}catch{}function values(){return Object.fromEntries([...document.querySelectorAll('section')].map(s=>[s.dataset.case,{rating:s.querySelector('select').value,notes:s.querySelector('textarea').value}]))}document.addEventListener('input',()=>{try{localStorage.setItem(key,JSON.stringify(values()))}catch{}});document.getElementById('save').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({run:${JSON.stringify(name)},judgments:values()},null,2)],{type:'application/json'}));a.download='judgments.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};</script></html>`;
await writeFile(join(directory, 'review.html'), html);
console.log(`Review: http://localhost:3000/api/benchmarks/${name}/review.html`);
if (results.cases.some(item => item.error || Object.values(item.checks).some(value => !value))) process.exitCode = 1;
