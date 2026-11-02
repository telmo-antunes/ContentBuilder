import type { ModelOption } from './models';
export const modelFamilies = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export function latestInFamily(models: ModelOption[], family: string) {
  const version = (id: string) => (id.match(/\d+/g) ?? []).slice(0, 2).map(Number);
  return models.filter(model => model.id.toLowerCase().includes(`claude-${family}-`)).sort((a, b) => {
    const av = version(a.id), bv = version(b.id);
    return (bv[0] ?? 0) - (av[0] ?? 0) || (bv[1] ?? 0) - (av[1] ?? 0) || (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  })[0];
}
