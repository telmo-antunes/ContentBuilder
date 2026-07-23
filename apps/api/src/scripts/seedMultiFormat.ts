/**
 * Dev demo for MULTI-FORMAT recipes: push the (now format-aware) reference
 * recipes onto the seeded brands' kits, and create one STORY (9:16) and one
 * SQUARE (1:1) authored project so the per-format vertical tuning can be
 * verified in the running app (view + PNG export) at $0 API.
 *
 *   npx tsx apps/api/src/scripts/seedMultiFormat.ts
 */
import { randomUUID } from 'node:crypto';
import type { Format } from '@contentbuilder/shared';
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel, ProjectModel } from '../models';
import type { BrandRecipe } from '@contentbuilder/shared';
import { dynatosRecipe, detailMastersRecipe } from '../lib/htmlDirector/recipes';

type Frag = { html: string; bg?: string };

// A short, vertical story deck for Dynatós — the story override gives these big
// type and Instagram-safe top/bottom padding.
const DYN_STORY: Frag[] = [
  { html: `<div class="logo"></div><div class="fill"></div><p class="eyebrow">The long game</p><h1 class="headline">Discipline is a<br/>daily vote.</h1><p class="tagline">Cast it before the world wakes up.</p>` },
  { html: `<p class="eyebrow">Habit one</p><div class="fill"></div><h1 class="headline sm">Win the<br/>morning.</h1><div class="rule"></div><p class="tagline">The first hour decides the other twenty-three.</p>` },
  { html: `<div class="logo"></div><div class="fill"></div><p class="eyebrow">Your move</p><h1 class="headline sm">DM me 'RESET'</h1><p class="tagline">for the daily checklist.</p><a class="cta">Start now</a><p class="handle">@dynatos</p>` },
];

// A compact square deck for DetailMasters — the square override tightens the
// serif scale and the giant stat so a full composition fits 1080×1080.
const DM_SQUARE: Frag[] = [
  { bg: 'photo', html: `<div class="logo-row"><div class="monogram"></div><span class="wordmark"><b>detail</b><i>masters</i></span></div><div class="fill"></div><p class="eyebrow">The CRM for detailers</p><h1 class="headline">Run your shop <span class="it">on autopilot.</span></h1>` },
  { html: `<p class="eyebrow">Results</p><h1 class="headline sm">Fewer no-shows</h1><div class="stat">40%</div><p class="body">Automatic reminders and deposits keep the bays full.</p>` },
  { html: `<p class="eyebrow">Every job, one screen</p><h1 class="headline sm">Booked. Paid. <span class="it">Reviewed.</span></h1><div class="rule"></div><div class="panel"><div class="row"><span class="tick">✓</span><span>Ceramic coating · Sat</span><em>Deposit paid</em></div><div class="row"><span class="tick">◷</span><span>Interior detail · 14:30</span><em>Reminder sent</em></div></div>` },
];

async function attach(
  name: string,
  recipe: BrandRecipe,
  title: string,
  format: Format,
  type: 'carousel' | 'story',
  frags: Frag[],
) {
  const biz = await BusinessModel.findOne({ name });
  if (!biz) {
    console.warn(`[multiformat] business not found: ${name} (run npm run seed first)`);
    return;
  }
  const kitRes = await BrandKitModel.updateMany({ businessId: biz._id }, { $set: { recipe } });
  await ProjectModel.deleteMany({ businessId: biz._id, title });
  const proj = await ProjectModel.create({
    businessId: biz._id,
    title,
    type,
    format,
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
  console.log(
    `[multiformat] ${name}: recipe updated (${kitRes.modifiedCount} kit) → ${format} "${title}" ${String(proj._id)}`,
  );
}

async function main() {
  await connectDb();
  await attach('Dynatós Program', dynatosRecipe, 'Discipline is a daily vote — story', '1080x1920', 'story', DYN_STORY);
  await attach('detailmasters CRM', detailMastersRecipe, 'Run your shop — square', '1080x1080', 'carousel', DM_SQUARE);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('[multiformat] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
