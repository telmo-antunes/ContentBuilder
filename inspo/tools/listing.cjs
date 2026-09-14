// List the 12 most recent posts of an account (logged out) as a labelled thumbnail sheet in inspo/.scratch/thumbs/. Run from the repo root.
const puppeteer = require(require("path").join(process.cwd(), "node_modules", "puppeteer"));
const sharp = require(require("path").join(process.cwd(), "node_modules", "sharp"));
const fs = require("fs"); const path = require("path");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const S = path.join(__dirname, "..", ".scratch"); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const account = process.argv[2];
  const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const p = await b.newPage(); await p.setViewport({ width: 1200, height: 1400 }); await p.setUserAgent(UA);
  try { await p.goto(`https://www.instagram.com/${account}/`, { waitUntil: "networkidle2", timeout: 60000 }); } catch {}
  await sleep(2500);
  const items = await p.evaluate(async () => {
    const out = []; const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const m = a.getAttribute("href").match(/^\/(?:[^/]+\/)?(p|reel)\/([A-Za-z0-9_-]+)\//); if (!m || seen.has(m[2])) continue; seen.add(m[2]);
      const img = a.querySelector("img"); const svg = a.querySelector("svg[aria-label]");
      let bytes = null;
      if (img) { try { const r = await fetch(img.src); bytes = Array.from(new Uint8Array(await r.arrayBuffer())); } catch {} }
      out.push({ code: m[2], kind: m[1], badge: svg ? svg.getAttribute("aria-label") : "", alt: (img && img.alt || "").slice(0, 160), bytes });
    }
    return out;
  });
  await b.close();
  const dir = path.join(S, "thumbs", account); fs.mkdirSync(dir, { recursive: true });
  const tiles = []; const W = 360;
  for (const it of items) {
    if (!it.bytes) continue;
    const label = `${it.code}  ${it.kind === "reel" ? "REEL" : it.badge === "Carousel" ? "CAROUSEL" : "single"}`;
    const svg = Buffer.from(`<svg width="${W}" height="28"><rect width="${W}" height="28" fill="#111"/><text x="6" y="19" font-family="Helvetica" font-size="15" fill="#fff">${label}</text></svg>`);
    const tile = await sharp(Buffer.from(it.bytes)).resize(W, W, { fit: "cover" }).extend({ bottom: 28, background: "#111" }).composite([{ input: svg, top: W, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
    tiles.push(tile);
  }
  fs.writeFileSync(path.join(dir, "listing.json"), JSON.stringify(items.map(({ bytes, ...r }) => r), null, 1));
  const cols = 4, rows = Math.ceil(tiles.length / cols), H = W + 28;
  const sheet = sharp({ create: { width: cols * W + (cols - 1) * 6, height: rows * H + (rows - 1) * 6, channels: 3, background: "#333" } });
  const comp = tiles.map((t, i) => ({ input: t, left: (i % cols) * (W + 6), top: Math.floor(i / cols) * (H + 6) }));
  await sheet.composite(comp).jpeg({ quality: 78 }).toFile(path.join(S, "thumbs", `${account}.jpg`));
  console.log(account, items.length, "tiles", tiles.length);
})().catch((e) => { console.error(e); process.exit(1); });
