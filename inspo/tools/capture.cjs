// Capture Instagram posts logged-out via the public embed page. Run from the repo root.
// usage: node inspo.cjs profile <account>            -> lists /p/ codes + grid screenshot
//        node inspo.cjs post <account> <code> [out]  -> every slide as jpg + meta.json
const puppeteer = require(require("path").join(process.cwd(), "node_modules", "puppeteer"));
const fs = require("fs"); const path = require("path");
const sharp = require(require("path").join(process.cwd(), "node_modules", "sharp"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const S = path.join(__dirname, "..", ".scratch");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open() {
  const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage(); await p.setViewport({ width: 1200, height: 1400 }); await p.setUserAgent(UA);
  return { b, p };
}
async function profile(account) {
  const { b, p } = await open();
  try { await p.goto(`https://www.instagram.com/${account}/`, { waitUntil: "networkidle2", timeout: 60000 }); } catch {}
  await sleep(2500);
  // dismiss login sheet if any
  await p.evaluate(() => { for (const el of document.querySelectorAll('[role=dialog]')) el.remove(); document.body.style.overflow = "auto"; });
  const items = await p.evaluate((acc) => {
    const out = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const m = a.getAttribute("href").match(/^\/(?:[^/]+\/)?(p|reel)\/([A-Za-z0-9_-]+)\//); if (!m) continue;
      if (seen.has(m[2])) continue; seen.add(m[2]);
      const img = a.querySelector("img");
      const svg = a.querySelector("svg[aria-label]");
      out.push({ code: m[2], kind: m[1], own: a.getAttribute("href").startsWith(`/${acc}/`) || !a.getAttribute("href").match(/^\/[^/]+\/(p|reel)\//), badge: svg ? svg.getAttribute("aria-label") : "", alt: (img && img.alt || "").slice(0, 120) });
    }
    return out;
  }, account);
  fs.mkdirSync(path.join(S, "profiles"), { recursive: true });
  await p.screenshot({ path: path.join(S, "profiles", `${account}.png`), fullPage: true });
  console.log(JSON.stringify(items, null, 0));
  await b.close();
}
async function post(account, code, outRoot) {
  const { b, p } = await open();
  const url = `https://www.instagram.com/p/${code}/embed/captioned/`;
  try { await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 }); } catch {}
  await sleep(1500);
  const slides = []; const seen = new Set(); let stale = 0;
  const grab = async () => {
    const found = await p.evaluate(() => Array.from(document.images).filter((i) => i.naturalWidth >= 600 && !i.classList.contains("EmbeddedMediaImage")).map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight })));
    if (!found.length) { // single-image post: the poster image
      const poster = await p.evaluate(() => Array.from(document.images).filter((i) => i.naturalWidth >= 600).map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight })));
      found.push(...poster);
    }
    let fresh = 0;
    for (const f of found) { const key = f.src.split("?")[0]; if (seen.has(key)) continue; seen.add(key); slides.push(f); fresh++; }
    return fresh;
  };
  await grab();
  for (let i = 0; i < 30; i++) {
    const next = await p.$('button[aria-label="Next"]');
    if (!next) break;
    await next.click().catch(() => {}); await sleep(900);
    const fresh = await grab();
    if (!fresh) { stale++; if (stale >= 2) break; } else stale = 0;
  }
  const meta = await p.evaluate(() => {
    const cap = document.querySelector(".Caption, [class*=Caption]");
    const video = !!document.querySelector("video");
    return { caption: (cap ? cap.innerText : document.body.innerText).replace(/\s+/g, " ").slice(0, 600), video };
  });
  const dir = path.join(outRoot, account, code); fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const s of slides) {
    n++;
    const buf = await p.evaluate(async (src) => { const r = await fetch(src); const a = await r.arrayBuffer(); return Array.from(new Uint8Array(a)); }, s.src).catch(() => null);
    if (!buf) { console.error("download failed", s.src.slice(0, 80)); continue; }
    await sharp(Buffer.from(buf)).resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(path.join(dir, `${String(n).padStart(2, "0")}.jpg`));
  }
  // one strip of every slide, for judging a carousel in a single look
  const files = fs.readdirSync(dir).filter((f) => /^\d\d\.jpg$/.test(f)).sort();
  if (files.length) {
    const T = 360; const tiles = [];
    for (const f of files) tiles.push({ input: await sharp(path.join(dir, f)).resize(T, T, { fit: "contain", background: "#222" }).toBuffer() });
    const cols = Math.min(files.length, 5), rows = Math.ceil(files.length / cols);
    await sharp({ create: { width: cols * T + (cols - 1) * 4, height: rows * T + (rows - 1) * 4, channels: 3, background: "#222" } })
      .composite(tiles.map((t, i) => ({ input: t.input, left: (i % cols) * (T + 4), top: Math.floor(i / cols) * (T + 4) })))
      .jpeg({ quality: 80 }).toFile(path.join(dir, "sheet.jpg"));
  }
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ account, code, url: `https://www.instagram.com/p/${code}/`, slides: slides.length, video: meta.video, caption: meta.caption }, null, 2));
  console.log(JSON.stringify({ account, code, slides: slides.length, sizes: slides.map((s) => `${s.w}x${s.h}`), video: meta.video }));
  await b.close();
}
const [cmd, a, c, o] = process.argv.slice(2);
(cmd === "profile" ? profile(a) : post(a, c, o || path.join(S, "inspo-test"))).catch((e) => { console.error(e); process.exit(1); });
