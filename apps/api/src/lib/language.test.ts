import { describe, expect, it } from 'vitest';
import { languageOf, promoLabelsFor } from './language';

describe('languageOf — the deck says which language it is in', () => {
  it('reads English', () => {
    expect(languageOf(['<div class="headline">Your website can do the first draft</div>', '<p>Paste your studio\'s website during setup and let it read what you publish.</p>'])).toBe('en');
  });
  it('reads Portuguese', () => {
    expect(languageOf(['<div class="headline">O momento certo para oferecer um serviço extra</div>', '<p>Não é no fim: é quando o carro está à tua frente.</p>'])).toBe('pt');
  });
  it('falls back to English on silence or a tie', () => {
    expect(languageOf([])).toBe('en');
    expect(languageOf(['<div>42%</div>'])).toBe('en');
  });
});

describe('promoLabelsFor', () => {
  it('gives the promo story its labels in that language', () => {
    expect(promoLabelsFor('en')).toEqual({ eyebrow: 'NEW POST', cta: 'See the full carousel' });
    expect(promoLabelsFor('pt').eyebrow).toBe('NOVO POST');
  });
});
