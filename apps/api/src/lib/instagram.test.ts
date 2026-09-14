import { describe, expect, it } from 'vitest';
import { permalinkCode } from './instagram';

describe('permalinkCode', () => {
  it('reads the shortcode from post and reel links, with or without a query', () => {
    expect(permalinkCode('https://www.instagram.com/p/DcjRsxVFJvp/')).toBe('DcjRsxVFJvp');
    expect(permalinkCode('https://www.instagram.com/reel/DdQCsy0IO3l/?igsh=abc')).toBe('DdQCsy0IO3l');
    expect(permalinkCode('https://www.instagram.com/notionhq/p/DcjRsxVFJvp/?img_index=2')).toBe('DcjRsxVFJvp');
  });
  it('is undefined for anything else', () => {
    expect(permalinkCode('https://example.com/p/abc')).toBeUndefined();
    expect(permalinkCode(undefined)).toBeUndefined();
  });
});
