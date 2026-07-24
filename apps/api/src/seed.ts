import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { connectDb, disconnectDb } from './db';
import { BusinessModel, BrandKitModel, ProjectModel, MediaAssetModel } from './models';
import { getStorage } from './storage';
import type { StorageProvider } from './storage/StorageProvider';
import { badgePng, solidPng } from './lib/png';
import { dynatosRecipe, detailMastersRecipe } from './lib/htmlDirector/recipes';

/** All seeded businesses (wiped + recreated on each run, so the seed is idempotent). */
const SEED_NAMES = ['Apex Auto Detailing', 'Dynatós Program', 'DetailMasters CRM'];

/** Legacy names from earlier live-analyze runs — wiped (not recreated) so re-seeding is clean. */
const LEGACY_NAMES = ['Dynatos', 'DetailMasters'];

const ASSETS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'seed-assets');

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

  // Media library seeds (uploads available to the brand — no block projects).
  await seedPhoto(storage, bid, 'photo-portrait-2.jpg');
  await seedPhoto(storage, bid, 'photo-story-1.jpg');
  // Apex intentionally has no recipe — it demonstrates the "design the recipe" path.
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
    // Reference recipe — new posts compose on-brand against it out of the box.
    recipe: dynatosRecipe,
    status: 'approved',
  });

  // Media library seeds (uploads available to the brand — no block projects).
  await seedPhoto(storage, bid, 'photo-portrait-3.jpg');
  await seedPhoto(storage, bid, 'photo-story-1.jpg');
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
    // Reference recipe — new posts compose on-brand against it out of the box.
    recipe: detailMastersRecipe,
    status: 'approved',
  });

  // Media library seeds (uploads available to the brand — no block projects).
  await seedPhoto(storage, bid, 'photo-portrait-4.jpg');
  await seedPhoto(storage, bid, 'photo-portrait-1.jpg');
  await seedPhoto(storage, bid, 'photo-story-2.jpg');
}

seed().catch(async (err) => {
  console.error('[seed] failed:', err);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
