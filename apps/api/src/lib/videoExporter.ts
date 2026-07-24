import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { dimensionsFor, type Format } from '@contentbuilder/shared';
import { config } from '../config';
import { getBrowser } from './browser';
import { getStorage } from '../storage';

/**
 * Render a project to an animated MP4. Each slide is driven through the hidden
 * /render route in MOTION mode; its reveal choreography is captured
 * deterministically — pause every CSS animation, then step `currentTime`
 * frame-by-frame and screenshot each frame — so the video is jitter-free
 * regardless of render speed. Frames from all slides are concatenated and
 * encoded with the bundled ffmpeg (H.264/yuv420p, Instagram-ready).
 */

const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** The reveal window (kept ~in sync with the web motion layer) + a readable hold. */
const MOTION_MS = 2600;
const HOLD_MS = 1300;

interface ExportableProject {
  _id: string;
  format: Format;
  slides: Array<{ id: string; order: number }>;
}

/** Load a slide in motion mode and wait until fonts + images are ready. */
async function gotoAndSettle(page: any, url: string, slideId: string): Promise<void> {
  let mounted = false;
  for (let attempt = 1; attempt <= 2 && !mounted; attempt++) {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    try {
      await page.waitForSelector('[data-slide-root]', { timeout: attempt === 1 ? 20000 : 30000 });
      mounted = true;
    } catch {
      if (attempt === 2) throw new Error(`slide ${slideId} never mounted for video`);
    }
  }
  await page.evaluate(async () => {
    const doc = (globalThis as { document?: any }).document;
    if (doc?.fonts?.ready) await doc.fonts.ready;
    const imgs: any[] = Array.from(doc?.images ?? []);
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.onload = () => resolve(null);
              img.onerror = () => resolve(null);
            }),
      ),
    );
    // The recipe's fonts are injected CLIENT-side after mount, so a single
    // fonts.ready can resolve BEFORE they're requested — then text paints in a
    // fallback (or invisibly). Wait until each element's own family is loaded.
    const els: any[] = Array.from(doc.querySelectorAll('.cb-slide *'));
    const families = new Set<string>();
    for (const el of els) {
      const fam = getComputedStyle(el).fontFamily;
      const size = getComputedStyle(el).fontSize || '16px';
      if (fam) families.add(`${size} ${fam}`);
    }
    await Promise.all(
      Array.from(families).map((f) => doc.fonts.load(f).catch(() => null)),
    );
    if (doc?.fonts?.ready) await doc.fonts.ready;
  });
  await new Promise((r) => setTimeout(r, 450));
}

export async function renderProjectToVideo(
  project: ExportableProject,
): Promise<{ buffer: Buffer; key: string; url: string; slides: number; frames: number }> {
  if (!ffmpegPath) throw new Error('ffmpeg binary unavailable');
  const { width, height } = dimensionsFor(project.format);
  const browser = await getBrowser();
  const base = config.webUrl.replace(/\/+$/, '');
  const ordered = [...project.slides].sort((a, b) => a.order - b.order);

  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const frames: Buffer[] = [];
  const revealFrames = Math.ceil(MOTION_MS / FRAME_MS);
  const holdFrames = Math.round(HOLD_MS / FRAME_MS);

  try {
    for (const slide of ordered) {
      const url = `${base}/render?projectId=${project._id}&slideId=${encodeURIComponent(slide.id)}&motion=1`;
      await gotoAndSettle(page, url, slide.id);
      // Freeze the timeline so we can seek it deterministically.
      await page.evaluate(() => (globalThis as any).document.getAnimations().forEach((a: any) => a.pause()));
      const el = await page.$('[data-slide-root]');
      if (!el) throw new Error(`Render route produced no slide for ${slide.id}`);

      // Reveal: step the timeline frame-by-frame. Only seek WITHIN the active
      // window — a paused animation seeked past its end paints stale in headless
      // Chrome (elements silently vanish even though computed opacity is 1).
      for (let f = 0; f < revealFrames; f++) {
        const t = Math.min(f * FRAME_MS, MOTION_MS);
        await page.evaluate(
          (ct: number) =>
            (globalThis as any).document.getAnimations().forEach((a: any) => {
              try {
                a.currentTime = ct;
              } catch {
                /* some animations reject a manual time */
              }
            }),
          t,
        );
        frames.push(Buffer.from(await el.screenshot({ type: 'png' })));
      }

      // Settled: drop the motion class so the slide renders in its plain static
      // state — identical to the still PNG export, and immune to the paused-seek
      // repaint quirk. This frame is also what we hold on.
      await page.evaluate(() => {
        const doc = (globalThis as any).document;
        doc.getAnimations().forEach((a: any) => {
          try {
            a.cancel();
          } catch {
            /* ignore */
          }
        });
        doc.querySelectorAll('.cb-motion').forEach((n: any) => n.classList.remove('cb-motion'));
      });
      await new Promise((r) => setTimeout(r, 120));
      const settled = Buffer.from(await el.screenshot({ type: 'png' }));
      for (let h = 0; h < holdFrames; h++) frames.push(settled);
    }
  } finally {
    await page.close().catch(() => {});
  }

  // Encode: write frames to a temp dir, run ffmpeg, read the MP4 back.
  const dir = await mkdtemp(join(tmpdir(), 'cbvid-'));
  try {
    await Promise.all(
      frames.map((buf, i) => writeFile(join(dir, `${String(i).padStart(5, '0')}.png`), buf)),
    );
    const outPath = join(dir, 'out.mp4');
    await runFfmpeg([
      '-y',
      '-framerate', String(FPS),
      '-i', join(dir, '%05d.png'),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      '-movflags', '+faststart',
      outPath,
    ]);
    const buffer = await readFile(outPath);
    const stored = await getStorage().save(`renders/${project._id}/video.mp4`, buffer, {
      contentType: 'video/mp4',
    });
    return { buffer, key: stored.key, url: stored.url, slides: ordered.length, frames: frames.length };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr?.on('data', (d) => {
      err += String(d);
    });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`)),
    );
  });
}
