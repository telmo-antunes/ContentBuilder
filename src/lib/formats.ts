// Instagram's canvases, and how each is seen. Shared by the prompt, the agent and the interface.
export const formats = [
  { id: 'post', label: 'Post', ratio: '4:5', width: 1080, height: 1350 },
  { id: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080 },
  { id: 'story', label: 'Story', ratio: '9:16', width: 1080, height: 1920 },
] as const;

export function isStory(size: { width: number; height: number }) { return size.height / size.width > 1.6; }

/** "story", "post", "square" or "1080x1920" → a canvas; null when it names none. */
export function parseCanvas(text: string): { width: number; height: number } | null {
  const named = formats.find(format => new RegExp(`\\b${format.id}\\b`, 'i').test(text) || text.includes(format.ratio));
  if (named) return { width: named.width, height: named.height };
  if (/\b(portrait|feed|carousel)\b/i.test(text)) return { width: 1080, height: 1350 };
  const size = text.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (!size) return null;
  const [width, height] = [Number(size[1]), Number(size[2])];
  return width >= 200 && width <= 2400 && height >= 200 && height <= 2400 ? { width, height } : null;
}

/** How the canvas is viewed on a phone, so the designer can reason about it. */
export function viewingNotes(size: { width: number; height: number }): string {
  if (isStory(size)) {
    const top = Math.round(size.height * 0.13), bottom = Math.round(size.height * 0.18);
    return `FORMAT: Instagram story (${size.width} × ${size.height}). Shown full screen on a phone about 390 points wide, so 1 canvas pixel is about ${(390 / size.width).toFixed(2)} points on screen. The top ${top} px sit under the progress bars and account name, and the bottom ${bottom} px under the reply bar and stickers: keep text and logos out of those bands. Each frame shows for about 5 seconds unless tapped.`;
  }
  const square = size.width === size.height;
  return `FORMAT: Instagram feed ${square ? 'post (1:1)' : 'post (4:5 portrait)'} at ${size.width} × ${size.height}. Seen in the feed on a phone about 390 points wide, so text renders at about ${(390 / size.width * 100).toFixed(0)}% of its pixel size: body text under about 34 px will be hard to read.${square ? '' : ' The profile grid crops posts to 3:4, trimming about 45 px from the top and bottom, so keep the cover\'s key words away from those edges.'} A carousel is swiped one slide at a time; the first slide competes in the feed and must earn the swipe.`;
}
