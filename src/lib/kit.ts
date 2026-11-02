import type { Brand, Kit } from './schema';

/** Fill only the brand-kit fields the user has left empty; their own choices always win. */
export function seedKit(kit: Kit, hints: Brand['kitHints']): Kit {
  if (!hints) return kit;
  return {
    ...kit,
    handle: kit.handle || hints.handle || '',
    voice: kit.voice || hints.voice || '',
    colors: kit.colors.length ? kit.colors : hints.colors ?? [],
    fonts: kit.fonts.length ? kit.fonts : hints.fonts ?? [],
    ...(kit.logo || hints.logo ? { logo: kit.logo ?? hints.logo } : {}),
  };
}

export function addLesson(kit: Kit, lesson: string): Kit {
  const clean = lesson.trim();
  if (!clean || kit.lessons.some(item => item.toLowerCase() === clean.toLowerCase())) return kit;
  return { ...kit, lessons: [...kit.lessons, clean].slice(-16) };
}

const question = /^(what|how|why|which|who|when|where|can you|could you|would you|should|is it|are there|help|any ideas|ideas|suggest|o que|como|porqu[eê]|qual|quais|quando|onde|podes|pode|consegues|ajuda|ideias|sugere|sugest[õo]es|devo|será)\b/i;
/**
 * A request that plainly asks for a post can go straight to generation, saving an agent call.
 * Questions, and topics too thin to have an angle (the agent offers hooks for those), still go to the agent.
 */
export function looksLikeCreate(text: string): boolean {
  const clean = text.trim();
  if (clean.endsWith('?') || question.test(clean)) return false;
  return clean.split(/\s+/).filter(Boolean).length >= 6;
}
