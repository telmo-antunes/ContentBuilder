import { expect, it } from 'vitest';
import { emptyWorkspace, workspaceSchema, type Brand } from './schema';
import { keepReference, removeReference, websiteReferences } from './references';
import { decodeDeck, generationMessage } from './ai';
const first: Brand = { url: 'https://first.example', notes: 'First identity', screenshot: 'data:image/jpeg;base64,YQ==', captures: [], images: [], previews: [] };
const local = `/api/assets/${'a'.repeat(64)}.png`;
const second: Brand = { ...first, url: 'https://second.example', notes: 'Second identity', images: [local], selectedImages: [local], previews: [{ url: local, original: local, thumbnail: `data:image/jpeg;base64,Yg==`, description: 'Header wordmark' }] };
it('adds a second identity, refreshes the same URL and promotes a remaining reference on removal', () => {
  const both = keepReference({ brand: first }, second);
  expect(websiteReferences(both)).toEqual([first, second]);
  const refreshed = keepReference(both, { ...second, notes: 'Refreshed' });
  expect(refreshed.references).toHaveLength(1);
  expect(refreshed.references[0].notes).toBe('Refreshed');
  expect(removeReference(both, first.url)).toEqual({ brand: second, references: [] });
});
it('passes both identities as optional inspiration and retains a local logo in the resulting deck', () => {
  const input = workspaceSchema.parse({ ...emptyWorkspace, brief: 'My unchanged brief', brand: first, references: [second] });
  const message = JSON.stringify(generationMessage(input));
  expect(message).toContain('First identity'); expect(message).toContain('Second identity'); expect(message).toContain('My unchanged brief');
  const deck = decodeDeck(JSON.stringify({ title: 'Joint post', slides: [{ html: `<img src="${local}">` }] }), input);
  expect(deck.assets).toEqual({ [local]: local });
  expect(deck.width).toBe(1080); expect(deck.height).toBe(1350);
});
