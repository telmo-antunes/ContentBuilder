import { kitSchema, type Brand, type Kit, type Profile, type Workspace } from './schema';

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 64);
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
export const MAX_BRANDS = 12;

export function profileName(profile: { kit: Kit; brand: Brand | null }): string {
  return profile.kit.handle ? `@${profile.kit.handle.replace(/^@/, '')}` : profile.brand ? hostOf(profile.brand.url) : 'New brand';
}
/** The brand the workspace is posting as, gathered from its top-level fields. */
export function activeProfile(workspace: Workspace): Profile {
  return { id: workspace.profileId || 'brand-1', kit: workspace.kit, brand: workspace.brand, references: workspace.references, pinned: workspace.pinned };
}
/** Every brand, the active one included, in a stable order. */
export function brandList(workspace: Workspace): { id: string; name: string; active: boolean; logo?: string }[] {
  const active = activeProfile(workspace);
  return [...workspace.profiles, active].map(profile => ({ id: profile.id, name: profileName(profile), active: profile.id === active.id, logo: profile.kit.logo }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function activate(workspace: Workspace, profile: Profile, others: Profile[]): Workspace {
  return { ...workspace, profileId: profile.id, kit: profile.kit, brand: profile.brand, references: profile.references, pinned: profile.pinned, profiles: others };
}
/** Posts as another brand; the post itself stays as it is. */
export function switchProfile(workspace: Workspace, id: string): Workspace {
  const current = activeProfile(workspace);
  const target = workspace.profiles.find(profile => profile.id === id);
  if (!target || target.id === current.id) return workspace;
  return activate(workspace, target, [...workspace.profiles.filter(profile => profile.id !== id), current]);
}
export function addProfile(workspace: Workspace): Workspace {
  if (workspace.profiles.length >= MAX_BRANDS - 1) return workspace;
  const blank: Profile = { id: newId(), kit: kitSchema.parse(undefined), brand: null, references: [], pinned: [] };
  return activate(workspace, blank, [...workspace.profiles, activeProfile(workspace)]);
}
/** Forgets the active brand and posts as the next one. */
export function removeProfile(workspace: Workspace): Workspace {
  const [next, ...rest] = workspace.profiles;
  return next ? activate(workspace, next, rest) : workspace;
}
