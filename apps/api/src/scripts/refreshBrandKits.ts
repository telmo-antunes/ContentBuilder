/**
 * Refresh the approved brand kits (colors + fonts + style descriptor) using the
 * Claude Code agent's judgment, grounded in each real website — NOT the app's
 * AI/vision pipeline. Run: npx tsx src/scripts/refreshBrandKits.ts
 */
import { connectDb, disconnectDb } from '../db';
import { BusinessModel, BrandKitModel } from '../models';

interface KitEdit {
  colors: { primary: string; secondary: string; accent: string; background: string; text: string; palette: string[] };
  heading: string;
  body: string;
  style: string;
}

// Keyed by business name. Palettes are coherent 5–6 role sets; fonts are bundled.
const KITS: Record<string, KitEdit> = {
  // Premium car-detailing SaaS with editorial elegance — dark + antique gold +
  // refined serif ("Every detail, remembered." is gold italic serif on the site).
  'detailmasters CRM': {
    colors: {
      background: '#0D1017',
      primary: '#C9A66B',
      secondary: '#4A5568',
      accent: '#E3C48D',
      text: '#F5F3EF',
      palette: ['#0D1017', '#1A1F29', '#C9A66B', '#E3C48D', '#4A5568', '#F5F3EF'],
    },
    heading: 'Playfair Display',
    body: 'Inter',
    style: 'Premium car-detailing SaaS with editorial elegance — near-black with antique-gold accents and refined serif headlines. Precise and aspirational: every detail, remembered.',
  },
  // Bold premium automotive — deep navy, electric cyan, metallic gold.
  'Apex Auto Detailing': {
    colors: {
      background: '#0B1F3A',
      primary: '#00C2FF',
      secondary: '#1B3A5C',
      accent: '#C9A227',
      text: '#F5F7FA',
      palette: ['#0B1F3A', '#1B3A5C', '#00C2FF', '#C9A227', '#F5F7FA'],
    },
    heading: 'Oswald',
    body: 'Inter',
    style: 'Bold, premium automotive — deep navy with electric-cyan energy and metallic-gold prestige. High-contrast, confident, showroom-grade.',
  },
  // Aspirational personal development ("dynatós" = powerful) — dark + warm gold, elegant.
  'Dynatós Program': {
    colors: {
      background: '#161616',
      primary: '#F5B301',
      secondary: '#2A2A2A',
      accent: '#FFCE45',
      text: '#FAFAFA',
      palette: ['#161616', '#2A2A2A', '#F5B301', '#FFCE45', '#FAFAFA'],
    },
    heading: 'Oswald',
    body: 'Inter',
    style: 'Bold, motivational coaching — a dark, high-contrast canvas warmed by gold, with heavy condensed headlines that command attention. You are capable; it is possible.',
  },
  // Premium detailing / PPF, understated — near-black with a vibrant emerald accent.
  'Outclass Atelier': {
    colors: {
      background: '#0A0B0A',
      primary: '#34D399',
      secondary: '#10B981',
      accent: '#6EE7B7',
      text: '#FFFFFF',
      palette: ['#0A0B0A', '#111311', '#34D399', '#6EE7B7', '#FFFFFF'],
    },
    heading: 'Montserrat',
    body: 'Inter',
    style: 'Modern, sleek, understated-premium — near-black with a vibrant emerald accent. Confident minimalism: excellence is earned, not proclaimed.',
  },
};

(async () => {
  await connectDb();
  const bizs = await BusinessModel.find().lean();
  for (const b of bizs) {
    const edit = KITS[b.name];
    if (!edit) {
      console.log(`skip ${b.name} (no refresh defined)`);
      continue;
    }
    const kit = await BrandKitModel.findOne({ businessId: b._id, status: 'approved' }).sort({ createdAt: -1 });
    if (!kit) {
      console.log(`skip ${b.name} (no approved kit)`);
      continue;
    }
    kit.set('colors', edit.colors);
    kit.set('fonts.render.heading', edit.heading);
    kit.set('fonts.render.body', edit.body);
    kit.set('styleDescriptor', edit.style);
    await kit.save();
    console.log(`refreshed kit: ${b.name} → ${edit.heading}/${edit.body}, bg ${edit.colors.background}, accent ${edit.colors.accent}`);
  }
  await disconnectDb();
  console.log('done');
})();
