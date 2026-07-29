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
 * Render a project's slides to animated MP4s — ONE PER SLIDE.
 *
 * Per-slide is the correct shape for Instagram: in a carousel or a story the
 * viewer decides when to advance, so the slides are independent clips (which is
 * also why inter-slide transitions would be meaningless). Each clip plays its
 * reveal choreography then holds the settled composition, and loops cleanly.
 *
 * Capture is DETERMINISTIC: every CSS animation is paused and its timeline is
 * stepped frame-by-frame, so output is identical regardless of render speed.
 */

const FPS = 30;
const FRAME_MS = 1000 / FPS;
/** How long the settled slide is held (readable) at the end of its clip. */
const HOLD_MS = 1400;

/** Thrown when a cancel request interrupts the render/encode loop. */
export class VideoExportCancelled extends Error {
  constructor() {
    super('Video export cancelled');
    this.name = 'VideoExportCancelled';
  }
}

/** Polled between frames/slides and while ffmpeg runs; true aborts the job. */
export type IsCancelled = () => boolean | Promise<boolean>;

export interface RenderedClip {
  /** Zero-padded filename: 01.mp4, 02.mp4, … */
  name: string;
  buffer: Buffer;
  key: string;
  url: string;
  frames: number;
}

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
  });
  await new Promise((r) => setTimeout(r, 300));
}

export async function renderSlidesToVideo(
  project: ExportableProject,
  /** Called with real 0–100 progress so the UI can show a determinate loader. */
  onProgress?: (percent: number) => void,
  /** Checked per slide and per frame batch — a true return aborts the render. */
  isCancelled?: IsCancelled,
): Promise<RenderedClip[]> {
  if (!ffmpegPath) throw new Error('ffmpeg binary unavailable');
  const { width, height } = dimensionsFor(project.format);
  const browser = await getBrowser();
  const storage = getStorage();
  const base = config.webUrl.replace(/\/+$/, '');
  const ordered = [...project.slides].sort((a, b) => a.order - b.order);
  const holdFrames = Math.round(HOLD_MS / FRAME_MS);

  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const out: RenderedClip[] = [];

  // Progress is reported against the whole job: each slide is an equal share,
  // split inside between loading, frame capture (the bulk), and encoding.
  const report = (slideIndex: number, within: number) =>
    onProgress?.(Math.min(99, Math.round(((slideIndex + within) / ordered.length) * 100)));
  const throwIfCancelled = async () => {
    if (isCancelled && (await isCancelled())) throw new VideoExportCancelled();
  };

  try {
    for (let i = 0; i < ordered.length; i++) {
      const slide = ordered[i]!;
      await throwIfCancelled();
      report(i, 0);
      const url = `${base}/render?projectId=${project._id}&slideId=${encodeURIComponent(slide.id)}&motion=1`;
      await gotoAndSettle(page, url, slide.id);
      report(i, 0.08);

      // Freeze the timeline, and read the reveal window from the page itself —
      // so each BRAND's motion signature (and a stat's count-up, which runs
      // longer) drives this clip's length automatically.
      const motionMs: number = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const anims = doc.getAnimations();
        anims.forEach((a: any) => a.pause());
        return anims.reduce((max: number, a: any) => {
          const t = a.effect?.getComputedTiming?.();
          const end = Number(t?.endTime ?? 0);
          return Number.isFinite(end) ? Math.max(max, end) : max;
        }, 0);
      });
      const revealFrames = Math.max(1, Math.ceil(motionMs / FRAME_MS));
      const el = await page.$('[data-slide-root]');
      if (!el) throw new Error(`Render route produced no slide for ${slide.id}`);

      const frames: Buffer[] = [];
      // Reveal: step the timeline. Only seek WITHIN the active window — a paused
      // animation seeked past its end paints stale in headless Chrome (elements
      // silently vanish even though computed opacity is 1).
      for (let f = 0; f < revealFrames; f++) {
        const t = Math.min(f * FRAME_MS, motionMs);
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
        // Frame capture is the bulk of the work — report it as it goes, and
        // give a cancel request a way in at the same cadence.
        if (f % 4 === 0) {
          await throwIfCancelled();
          report(i, 0.08 + 0.74 * ((f + 1) / revealFrames));
        }
      }

      /**
       * Settled: drop the REVEAL so the slide renders in its plain static state
       * — identical to the still PNG export, and immune to the stale-paint
       * quirk above.
       *
       * The ambient drift must NOT be dropped with it. Cancelling every
       * animation would snap a push-in back to its starting scale for the whole
       * 1400ms hold — the same trap that made a counted stat fall back to zero.
       * So ambient animations are seeked to their END and left in place, and the
       * hold genuinely holds where the motion finished.
       */
      await page.evaluate(() => {
        const doc = (globalThis as any).document;
        doc.getAnimations().forEach((a: any) => {
          const name = String(a.animationName ?? '');
          if (name.startsWith('cb-amb-')) {
            try {
              const t = a.effect?.getComputedTiming?.();
              const end = Number(t?.endTime ?? 0);
              if (Number.isFinite(end)) a.currentTime = end;
            } catch {
              /* leave it wherever it is rather than losing it */
            }
            return;
          }
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

      const name = `${String(i + 1).padStart(2, '0')}.mp4`;
      await throwIfCancelled();
      report(i, 0.86); // encoding
      const buffer = await encode(frames, isCancelled);
      report(i, 1);
      const stored = await storage.save(`renders/${project._id}/${name}`, buffer, {
        contentType: 'video/mp4',
      });
      out.push({ name, buffer, key: stored.key, url: stored.url, frames: frames.length });
    }
  } finally {
    await page.close().catch(() => {});
  }

  return out;
}

/** PNG frames → one Instagram-ready H.264 MP4. */
async function encode(frames: Buffer[], isCancelled?: IsCancelled): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'cbvid-'));
  try {
    await Promise.all(
      frames.map((buf, i) => writeFile(join(dir, `${String(i).padStart(5, '0')}.png`), buf)),
    );
    const outPath = join(dir, 'out.mp4');
    await runFfmpeg(
      [
        '-y',
        '-framerate', String(FPS),
        '-i', join(dir, '%05d.png'),
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '20',
        '-movflags', '+faststart',
        outPath,
      ],
      isCancelled,
    );
    return await readFile(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[], isCancelled?: IsCancelled): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath as string, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    let killed = false;
    // A cancel request must reach a running encode too — poll and kill the child.
    const watcher = isCancelled
      ? setInterval(() => {
          void Promise.resolve(isCancelled())
            .then((cancelled) => {
              if (cancelled && !killed) {
                killed = true;
                proc.kill('SIGKILL');
              }
            })
            .catch(() => {});
        }, 250)
      : undefined;
    const settle = (fn: () => void) => {
      if (watcher) clearInterval(watcher);
      fn();
    };
    proc.stderr?.on('data', (d) => {
      err += String(d);
    });
    proc.on('error', (e) => settle(() => reject(e)));
    proc.on('close', (code) =>
      settle(() =>
        killed
          ? reject(new VideoExportCancelled())
          : code === 0
            ? resolve()
            : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`)),
      ),
    );
  });
}
