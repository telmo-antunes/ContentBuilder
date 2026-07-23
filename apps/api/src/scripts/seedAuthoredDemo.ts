/**
 * Dev demo: attach the reference recipes to the real seeded brands and create a
 * carousel of AUTHORED slides for each, so the whole HTML-authoring pipeline can
 * be exercised end-to-end in the running app (view + PNG export) at $0 API.
 * The fragments below are the formula's output (composed under its hard rules).
 *
 *   npx tsx apps/api/src/scripts/seedAuthoredDemo.ts
 */
import { randomUUID } from 'node:crypto';
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel, ProjectModel } from '../models';
import type { BrandRecipe } from '@contentbuilder/shared';
import { dynatosRecipe, detailMastersRecipe } from '../lib/htmlDirector/recipes';

type Frag = { html: string; bg?: string };

const DYN: Frag[] = [
  { html: `<div class="logo"></div><div class="fill"></div><p class="eyebrow">Founder notes</p><h1 class="headline sm">3 traits of resilient founders</h1><p class="tagline">What actually keeps you in the game.</p>` },
  { html: `<p class="eyebrow">Mindset</p><div class="fill"></div><h1 class="headline">Recovery beats grit</h1><div class="rule"></div><p class="tagline">It's not how hard you push — it's how fast you reset.</p>` },
  { html: `<div class="fill"></div><p class="quote">"You don't rise to your goals. You <span class="em">fall to your systems.</span>"</p><p class="attr">— A lesson learned twice</p><div class="fill"></div>` },
  { html: `<div class="logo"></div><div class="fill"></div><p class="eyebrow">Your weekly reset</p><h1 class="headline sm">DM me 'RESET'</h1><p class="tagline">for the checklist.</p><a class="cta">Start now</a><p class="handle">@dynatos</p>` },
];

const DM: Frag[] = [
  { bg: 'photo', html: `<div class="logo-row"><div class="monogram"></div><span class="wordmark"><b>detail</b><i>masters</i></span></div><div class="fill"></div><p class="eyebrow">The CRM built for detailers</p><h1 class="headline">Run your shop <span class="it">on autopilot.</span></h1><p class="body">Bookings, reminders, payments and reviews — handled in one place.</p>` },
  { html: `<p class="eyebrow">Dashboard</p><h1 class="headline sm">Every job on <span class="it">one screen.</span></h1><div class="rule"></div><p class="body">Bookings, reminders, payments and reviews — the whole shop, at a glance.</p><div class="fill"></div><div class="panel"><div class="row"><span class="tick">◷</span><span>Interior detail · 14:30</span><em>Reminder sent</em></div><div class="row"><span class="tick">✓</span><span>Ceramic coating · Sat</span><em>Deposit paid</em></div></div>` },
  { html: `<p class="eyebrow">Results</p><h1 class="headline sm">Cut no-shows by</h1><div class="stat">40%</div><p class="body">Automatic reminders and deposits mean fewer empty bays — and more revenue per day.</p>` },
  { html: `<div class="logo-row"><div class="monogram"></div><span class="wordmark"><b>detail</b><i>masters</i></span></div><div class="fill"></div><p class="eyebrow">Get started</p><h1 class="headline sm">Your vehicle deserves <span class="it">exceptional care.</span></h1><a class="cta">Start a free 14-day trial</a><p class="handle">detailmasters.pro · @detailmasters</p>` },
];

async function attach(name: string, recipe: BrandRecipe, title: string, frags: Frag[]) {
  const biz = await BusinessModel.findOne({ name });
  if (!biz) {
    console.warn(`[demo] business not found: ${name} (run npm run seed first)`);
    return;
  }
  // Set on ALL the business's kits — regenerations left several approved kits,
  // and getApprovedKit() returns the newest, so update them all.
  const kitRes = await BrandKitModel.updateMany({ businessId: biz._id }, { $set: { recipe } });
  await ProjectModel.deleteMany({ businessId: biz._id, title });
  const proj = await ProjectModel.create({
    businessId: biz._id,
    title,
    type: 'carousel',
    format: '1080x1350',
    status: 'draft',
    settings: { theme: 'editorial', slideCounter: false },
    slides: frags.map((f, i) => ({
      id: randomUUID(),
      order: i + 1,
      layoutType: 'TextOnly',
      blocks: [],
      imageNeed: 'none',
      authored: { html: f.html, ...(f.bg ? { bg: f.bg } : {}) },
    })),
  });
  console.log(`[demo] ${name}: recipe attached (${kitRes.modifiedCount} kit) → project ${String(proj._id)} "${title}"`);
}

async function main() {
  await connectDb();
  await attach('Dynatós Program', dynatosRecipe, 'Recovery beats grit — authored', DYN);
  await attach('detailmasters CRM', detailMastersRecipe, 'Run your shop — authored', DM);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[demo] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
