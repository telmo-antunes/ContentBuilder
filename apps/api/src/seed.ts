import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { connectDb, disconnectDb } from './db';
import { BusinessModel, BrandKitModel, ProjectModel, MediaAssetModel } from './models';
import { getStorage } from './storage';
import type { StorageProvider } from './storage/StorageProvider';
import { badgePng, solidPng } from './lib/png';
import type { Slide } from '@contentbuilder/shared';

/** All seeded businesses (wiped + recreated on each run, so the seed is idempotent). */
const SEED_NAMES = ['Apex Auto Detailing', 'Dynatós Program', 'DetailMasters CRM'];

/** Legacy names from earlier live-analyze runs — wiped (not recreated) so re-seeding is clean. */
const LEGACY_NAMES = ['Dynatos', 'DetailMasters'];

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed-assets');

/** Attach a generated slide id to each seed slide. */
function withIds(slides: Omit<Slide, 'id'>[]): Slide[] {
  return slides.map((s) => ({ ...s, id: randomUUID() }));
}

async function loadAsset(file: string): Promise<Buffer> {
  return readFile(resolve(ASSETS_DIR, file));
}

function contentTypeFor(file: string): string {
  return file.endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/** Save a brand asset (logo / screenshot) from seed-assets into storage. */
async function saveBrandAsset(storage: StorageProvider, businessId: string, kind: string, file: string) {
  const buf = await loadAsset(file);
  return storage.save(`seed/${businessId}/${kind}.${file.split('.').pop()}`, buf, {
    contentType: contentTypeFor(file),
  });
}

/** Save a photo from seed-assets, create a MediaAsset, and return its id (for slide.mediaAssetId). */
async function seedPhoto(storage: StorageProvider, businessId: string, file: string): Promise<string> {
  const buf = await loadAsset(file);
  const meta = await sharp(buf)
    .metadata()
    .catch(() => ({ width: 0, height: 0 }));
  const stored = await storage.save(`seed/${businessId}/photo-${file}`, buf, {
    contentType: contentTypeFor(file),
  });
  const doc = await MediaAssetModel.create({
    businessId,
    type: 'upload',
    key: stored.key,
    url: stored.url,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  });
  return String(doc._id);
}

async function wipePreviousSeed() {
  const names = [...SEED_NAMES, ...LEGACY_NAMES];
  const existing = await BusinessModel.find({ name: { $in: names } });
  for (const b of existing) {
    await BrandKitModel.deleteMany({ businessId: b._id });
    await ProjectModel.deleteMany({ businessId: b._id });
    await MediaAssetModel.deleteMany({ businessId: b._id });
  }
  await BusinessModel.deleteMany({ name: { $in: names } });
}

async function seed() {
  await connectDb();
  const storage = getStorage();
  await wipePreviousSeed();

  await seedApex(storage);
  await seedDynatos(storage);
  await seedDetailMasters(storage);

  const counts = {
    businesses: await BusinessModel.countDocuments({ name: { $in: SEED_NAMES } }),
    brandKits: await BrandKitModel.countDocuments({}),
    projects: await ProjectModel.countDocuments({}),
    media: await MediaAssetModel.countDocuments({}),
  };
  console.log('[seed] done:', counts);
  await disconnectDb();
}

// ─────────────────────────────────────────────────────────────────────────────
// Apex Auto Detailing — fictional local-service brand (generated badge + photos).
// ─────────────────────────────────────────────────────────────────────────────
async function seedApex(storage: StorageProvider) {
  const logo = await storage.save('seed/apex-logo.png', badgePng(400, '#0B1F3A', '#00C2FF'), {
    contentType: 'image/png',
  });
  const screenshot = await storage.save('seed/apex-home.png', solidPng(1280, 800, '#0B1F3A'), {
    contentType: 'image/png',
  });

  const business = await BusinessModel.create({
    name: 'Apex Auto Detailing',
    websiteUrl: 'https://apexdetailing.example',
    profile: {
      category: 'local-service',
      offer: 'Premium mobile car detailing & ceramic coating',
      audience: 'car enthusiasts and busy professionals',
      tone: ['Premium', 'Bold', 'Professional'],
      goal: 'leads',
      completedAt: new Date(),
    },
  });
  const bid = String(business._id);

  await BrandKitModel.create({
    businessId: business._id,
    colors: {
      primary: '#00C2FF',
      secondary: '#1B3A5C',
      accent: '#C9A227',
      background: '#0B1F3A',
      text: '#F5F7FA',
      palette: ['#0B1F3A', '#1B3A5C', '#00C2FF', '#C9A227', '#F5F7FA'],
    },
    fonts: {
      detected: { heading: 'Montserrat', body: 'Inter' },
      render: { heading: 'Montserrat', body: 'Inter' },
    },
    logo: { sourceUrl: 'https://apexdetailing.example/logo.svg', key: logo.key, url: logo.url },
    logoTreatment: 'original',
    styleDescriptor: 'bold, premium, high-contrast dark theme with metallic accents',
    homepageScreenshot: { key: screenshot.key, url: screenshot.url },
    provenance: { colors: 'sampled', fonts: 'computed+mapped', roles: 'vision', logo: 'dom' },
    status: 'approved',
  });

  const split = await seedPhoto(storage, bid, 'photo-portrait-2.jpg');
  const story = await seedPhoto(storage, bid, 'photo-story-1.jpg');

  await ProjectModel.create({
    businessId: business._id,
    title: 'Ceramic Coating Weekend',
    type: 'carousel',
    format: '1080x1350',
    status: 'draft',
    settings: { theme: 'soft', slideCounter: true },
    slides: withIds([
      { order: 1, layoutType: 'Cover', imageNeed: 'none', blocks: [
        { type: 'eyebrow', text: 'LIMITED OFFER' },
        { type: 'title', text: 'Ceramic Coating Weekend' },
        { type: 'subtitle', text: '20% off all packages' },
        { type: 'date', text: 'This Sat–Sun only' },
      ] },
      { order: 2, layoutType: 'SplitImageText', imageNeed: 'upload', mediaAssetId: split, overrides: { imageTreatment: 'tint' }, blocks: [
        { type: 'title', text: 'Why ceramic?' },
        { type: 'paragraph', text: 'A ceramic coating bonds to your paint, repelling water, dirt, and UV — keeping that just-detailed look for years.' },
      ] },
      { order: 3, layoutType: 'Checklist', imageNeed: 'none', blocks: [
        { type: 'title', text: "What's included" },
        { type: 'list', text: '', items: [
          'Full exterior decontamination wash',
          'Single-stage paint correction',
          '9H ceramic coating',
          '12-month protection guarantee',
        ] },
      ] },
      { order: 4, layoutType: 'CTA', imageNeed: 'none', blocks: [
        { type: 'cta', text: 'Book your slot this weekend' },
        { type: 'handle', text: '@apexdetailing' },
      ] },
    ]),
  });

  await ProjectModel.create({
    businessId: business._id,
    title: 'Ceramic Weekend — Stories',
    type: 'story',
    format: '1080x1920',
    status: 'draft',
    settings: { theme: 'soft', slideCounter: false },
    slides: withIds([
      { order: 1, layoutType: 'BackgroundImage', imageNeed: 'upload', mediaAssetId: story, overrides: { imageTreatment: 'duotone' }, blocks: [
        { type: 'eyebrow', text: 'THIS WEEKEND' },
        { type: 'title', text: '20% off ceramic coating' },
      ] },
      { order: 2, layoutType: 'CTA', imageNeed: 'none', blocks: [
        { type: 'title', text: 'Limited slots' },
        { type: 'cta', text: 'Book now — link in bio' },
        { type: 'handle', text: '@apexdetailing' },
      ] },
    ]),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynatós Program — real coach-creator brand (extracted kit + real logo/screenshot).
// ─────────────────────────────────────────────────────────────────────────────
async function seedDynatos(storage: StorageProvider) {
  const business = await BusinessModel.create({
    name: 'Dynatós Program',
    websiteUrl: 'https://dynatos.vercel.app',
    profile: {
      category: 'coach-creator',
      offer: 'Coaching for founders & leaders',
      audience: 'founders and leaders',
      tone: ['Inspiring', 'Warm', 'Professional'],
      goal: 'leads',
      completedAt: new Date(),
    },
  });
  const bid = String(business._id);
  const logo = await saveBrandAsset(storage, bid, 'logo', 'dynatos-logo.png');
  const home = await saveBrandAsset(storage, bid, 'home', 'dynatos-home.png');

  await BrandKitModel.create({
    businessId: business._id,
    colors: {
      primary: '#FCBC04',
      secondary: '#946C0C',
      accent: '#FDDC7B',
      background: '#3F371C',
      text: '#C4BCB4',
      palette: ['#3F371C', '#FCBC04', '#946C0C', '#979480', '#C4BCB4', '#FDDC7B'],
    },
    fonts: {
      detected: { heading: 'Anton', body: 'DM Serif Text' },
      render: { heading: 'Montserrat', body: 'Source Serif 4' },
    },
    logo: { sourceUrl: 'https://dynatos.vercel.app', key: logo.key, url: logo.url },
    logoTreatment: 'mono',
    styleDescriptor:
      'Dark, premium masculine aesthetic with bold gold accents and high contrast for impactful coaching brand messaging',
    homepageScreenshot: { key: home.key, url: home.url },
    provenance: { colors: 'sampled', fonts: 'computed+mapped', roles: 'vision', logo: 'dom' },
    status: 'approved',
  });

  const energy = await seedPhoto(storage, bid, 'photo-portrait-3.jpg');
  const story = await seedPhoto(storage, bid, 'photo-story-1.jpg');

  await ProjectModel.create({
    businessId: business._id,
    title: '3 traits of resilient founders',
    type: 'carousel',
    format: '1080x1350',
    status: 'draft',
    settings: { theme: 'editorial', slideCounter: true },
    slides: withIds([
      { order: 1, layoutType: 'Cover', imageNeed: 'none', blocks: [
        { type: 'eyebrow', text: 'FOUNDER NOTES' },
        { type: 'title', text: '3 traits of resilient founders' },
        { type: 'subtitle', text: 'What actually keeps you in the game' },
      ] },
      { order: 2, layoutType: 'Statement', imageNeed: 'none', blocks: [
        { type: 'eyebrow', text: 'MINDSET' },
        { type: 'title', text: 'Recovery beats grit' },
        { type: 'subtitle', text: "It's not how hard you push — it's how fast you reset." },
      ] },
      { order: 3, layoutType: 'SplitImageText', imageNeed: 'upload', mediaAssetId: energy, overrides: { imageTreatment: 'none' }, blocks: [
        { type: 'title', text: 'Protect your energy' },
        { type: 'paragraph', text: 'The founders who last guard their calendar like runway. Energy — not time — is the scarce resource.' },
      ] },
      { order: 4, layoutType: 'Checklist', imageNeed: 'none', blocks: [
        { type: 'title', text: 'Your weekly reset' },
        { type: 'list', text: '', items: [
          'One full day genuinely offline',
          'A walk with no podcast, no phone',
          'Review the wins, not just the gaps',
          'Say no to one good-but-not-great thing',
        ] },
      ] },
      { order: 5, layoutType: 'Quote', imageNeed: 'none', blocks: [
        { type: 'quote', text: "You don't rise to your goals. You fall to your systems." },
        { type: 'attribution', text: 'A lesson learned twice' },
      ] },
      { order: 6, layoutType: 'CTA', imageNeed: 'none', blocks: [
        { type: 'cta', text: "DM me 'RESET' for the checklist" },
        { type: 'handle', text: '@dynatos' },
      ] },
    ]),
  });

  await ProjectModel.create({
    businessId: business._id,
    title: 'Lead without burning out — Story',
    type: 'story',
    format: '1080x1920',
    status: 'draft',
    settings: { theme: 'editorial', slideCounter: false },
    slides: withIds([
      { order: 1, layoutType: 'BackgroundImage', imageNeed: 'upload', mediaAssetId: story, overrides: { imageTreatment: 'duotone' }, blocks: [
        { type: 'eyebrow', text: 'FREE TRAINING' },
        { type: 'title', text: 'Lead without burning out' },
      ] },
      { order: 2, layoutType: 'CTA', imageNeed: 'none', blocks: [
        { type: 'title', text: 'Save your seat' },
        { type: 'cta', text: 'Link in bio' },
        { type: 'handle', text: '@dynatos' },
      ] },
    ]),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DetailMasters CRM — real saas-product brand (extracted kit + real logo/screenshot).
// ─────────────────────────────────────────────────────────────────────────────
async function seedDetailMasters(storage: StorageProvider) {
  const business = await BusinessModel.create({
    name: 'DetailMasters CRM',
    websiteUrl: 'https://detailmasters.pro',
    profile: {
      category: 'saas-product',
      offer: 'Software for auto-detailing businesses',
      audience: 'detailing shop owners',
      tone: ['Professional', 'Bold', 'Technical'],
      goal: 'leads',
      completedAt: new Date(),
    },
  });
  const bid = String(business._id);
  const logo = await saveBrandAsset(storage, bid, 'logo', 'detailmasters-logo.png');
  const home = await saveBrandAsset(storage, bid, 'home', 'detailmasters-home.png');

  await BrandKitModel.create({
    businessId: business._id,
    colors: {
      primary: '#B68C49',
      secondary: '#6E6863',
      accent: '#D4C09D',
      background: '#4B3B27',
      text: '#D4C09D',
      palette: ['#6E6863', '#B68C49', '#B5A996', '#4B3B27', '#D4C09D', '#644C2A'],
    },
    fonts: {
      detected: { heading: 'Playfair Display', body: 'Inter' },
      render: { heading: 'Lora', body: 'Inter' },
    },
    logo: { sourceUrl: 'https://detailmasters.pro', key: logo.key, url: logo.url },
    logoTreatment: 'mono',
    styleDescriptor: 'Luxurious, dark-toned with warm gold accents, sophisticated and premium aesthetic',
    homepageScreenshot: { key: home.key, url: home.url },
    provenance: { colors: 'sampled', fonts: 'computed+mapped', roles: 'vision', logo: 'dom' },
    status: 'approved',
  });

  const dash = await seedPhoto(storage, bid, 'photo-portrait-4.jpg');
  const noShow = await seedPhoto(storage, bid, 'photo-portrait-1.jpg');
  const story = await seedPhoto(storage, bid, 'photo-story-2.jpg');

  await ProjectModel.create({
    businessId: business._id,
    title: 'Run your shop on autopilot',
    type: 'carousel',
    format: '1080x1350',
    status: 'draft',
    settings: { theme: 'bold', slideCounter: true },
    slides: withIds([
      { order: 1, layoutType: 'Cover', imageNeed: 'none', blocks: [
        { type: 'eyebrow', text: 'NEW' },
        { type: 'title', text: 'Run your shop on autopilot' },
        { type: 'subtitle', text: 'The CRM built for detailers' },
      ] },
      { order: 2, layoutType: 'CenteredHero', imageNeed: 'upload', mediaAssetId: dash, overrides: { imageTreatment: 'tint' }, blocks: [
        { type: 'eyebrow', text: 'DASHBOARD' },
        { type: 'title', text: 'Every job on one screen' },
        { type: 'paragraph', text: 'Bookings, reminders, payments and reviews — handled in one place.' },
      ] },
      { order: 3, layoutType: 'Checklist', imageNeed: 'none', blocks: [
        { type: 'title', text: 'What you get' },
        { type: 'list', text: '', items: [
          'Online booking synced to your calendar',
          'Automated SMS reminders',
          'Card payments and deposits',
          'Review requests on autopilot',
        ] },
      ] },
      { order: 4, layoutType: 'SplitImageText', imageNeed: 'upload', mediaAssetId: noShow, overrides: { imageTreatment: 'none' }, blocks: [
        { type: 'title', text: 'Cut no-shows by 40%' },
        { type: 'paragraph', text: 'Automatic reminders and deposits mean fewer empty bays and more revenue per day.' },
      ] },
      { order: 5, layoutType: 'CTA', imageNeed: 'none', blocks: [
        { type: 'cta', text: 'Start a free 14-day trial' },
        { type: 'handle', text: '@detailmasters' },
      ] },
    ]),
  });

  await ProjectModel.create({
    businessId: business._id,
    title: 'Stop losing bookings — Story',
    type: 'story',
    format: '1080x1920',
    status: 'draft',
    settings: { theme: 'bold', slideCounter: false },
    slides: withIds([
      { order: 1, layoutType: 'BackgroundImage', imageNeed: 'upload', mediaAssetId: story, overrides: { imageTreatment: 'duotone' }, blocks: [
        { type: 'eyebrow', text: 'FOR DETAILERS' },
        { type: 'title', text: 'Stop losing bookings to DMs' },
      ] },
      { order: 2, layoutType: 'CTA', imageNeed: 'none', blocks: [
        { type: 'title', text: 'See it in action' },
        { type: 'cta', text: 'Free trial — link in bio' },
        { type: 'handle', text: '@detailmasters' },
      ] },
    ]),
  });
}

seed().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
