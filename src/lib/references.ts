import type { Brand, Workspace } from './schema';
type References = Pick<Workspace, 'brand'> & { references?: Brand[] };
export function websiteReferences(input: References): Brand[] { return [...(input.brand ? [input.brand] : []), ...(input.references ?? [])]; }
export function selectedReferenceImages(brand: Brand) { return brand.images.filter(url => (brand.selectedImages ?? brand.images).includes(url)); }
const key = (url: string) => url.replace(/\/$/, '');
export function keepReference(input: References, next: Brand): Pick<Workspace, 'brand' | 'references'> {
  const all = websiteReferences(input); const index = all.findIndex(brand => key(brand.url) === key(next.url));
  if (index < 0) all.push(next); else all[index] = next;
  return { brand: all[0] ?? null, references: all.slice(1) };
}
export function removeReference(input: References, url: string): Pick<Workspace, 'brand' | 'references'> {
  const all = websiteReferences(input).filter(brand => brand.url !== url);
  return { brand: all[0] ?? null, references: all.slice(1) };
}
