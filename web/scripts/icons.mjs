// Renders public/icon.svg to the PNG icons the manifest and iOS need, using Chromium via
// Playwright. Run with `pnpm --filter web icons`. Playwright is not a dependency of this
// package: it is resolved from `PLAYWRIGHT_MODULE` or the machine's global install.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
const BG = '#1f7a5c'; // the icon's own background colour

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of candidates) {
    try {
      return await import(c);
    } catch {
      // try the next one
    }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_MODULE to its index.mjs or install it globally.');
}

/** @type {Array<{ file: string, size: number, maskable?: boolean, opaque?: boolean }>} */
const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, opaque: true },
];

function page(svg, size, { maskable = false, opaque = false }) {
  // Maskable: solid background with the artwork inside the 80% safe zone (10% padding each side).
  const inner = maskable ? Math.round(size * 0.8) : size;
  const pad = Math.round((size - inner) / 2);
  const bg = maskable || opaque ? BG : 'transparent';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:${bg};}
    .wrap{position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px;}
    .wrap svg{display:block;width:100%;height:100%;}
  </style></head><body><div class="wrap">${svg}</div></body></html>`;
}

const { chromium } = await loadPlaywright();
const svg = await readFile(resolve(publicDir, 'icon.svg'), 'utf8');
await mkdir(publicDir, { recursive: true });

const launchOpts = {};
if (process.env.CHROMIUM_PATH) launchOpts.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launchOpts);
try {
  for (const t of targets) {
    const ctx = await browser.newContext({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.setContent(page(svg, t.size, t), { waitUntil: 'load' });
    const png = await p.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: t.size, height: t.size },
      omitBackground: !(t.maskable || t.opaque),
    });
    await writeFile(resolve(publicDir, t.file), png);
    console.log(`wrote public/${t.file} (${t.size}×${t.size}${t.maskable ? ', maskable' : ''})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
