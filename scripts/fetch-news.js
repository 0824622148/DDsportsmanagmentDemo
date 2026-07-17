#!/usr/bin/env node
'use strict';

/**
 * Fetches news submissions from a public Google Sheets CSV and regenerates
 * the news card sections in index.html and news.html.
 *
 * Required GitHub Secret (Settings → Secrets → Actions):
 *   GOOGLE_SHEET_CSV_URL — the full published CSV URL from the Sheet
 *   (File → Share → Publish to web → "Form Responses 1" tab → CSV → Publish → copy URL)
 *
 * Column order (matches Google Form output + one manual column):
 *   A: Timestamp  B: Title  C: Category  D: Date  E: Excerpt
 *   F: Image URL  G: Published
 *
 * Image URL column accepts:
 *   - Google Drive share link: https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   - local: prefix for already-committed images: local:assets/news-rodan-pillay.jpeg
 *   - Blank: uses the site placeholder image
 *
 * Published column: set to "no" to hide a row. Anything else (blank, "yes") = visible.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const SHEET_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL;
const HOME_LIMIT    = parseInt(process.env.HOME_LIMIT || '3',  10);
const NEWS_LIMIT    = parseInt(process.env.NEWS_LIMIT || '20', 10);

const ROOT        = path.join(__dirname, '..');
const IMG_DIR     = path.join(ROOT, 'assets', 'news-images');
const INDEX_HTML  = path.join(ROOT, 'index.html');
const NEWS_HTML   = path.join(ROOT, 'news.html');
const OVERRIDES   = path.join(ROOT, 'news-overrides.json');
const PLACEHOLDER = 'assets/logo/dd-logo.jpg';

const MARKER_START = '<!-- INSTAGRAM-NEWS-START -->';
const MARKER_END   = '<!-- INSTAGRAM-NEWS-END -->';

const CATEGORY = {
  transfer:     { badge: 'badge-gold',    label: 'Transfer'     },
  announcement: { badge: 'badge-outline', label: 'Announcement' },
  scouting:     { badge: 'badge-navy',    label: 'Scouting'     },
  event:        { badge: 'badge-outline', label: 'Event'        },
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsGet(requestUrl) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    const fetch = (u) => {
      if (++hops > 10) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      const lib    = parsed.protocol === 'https:' ? https : http;
      lib.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetch(new URL(res.headers.location, u).href);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end',  () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      }).on('error', reject);
    };
    fetch(requestUrl);
  });
}

function downloadImage(imageUrl, destPath) {
  return new Promise((resolve, reject) => {
    let hops = 0;
    const fetch = (u) => {
      if (++hops > 10) { reject(new Error('Too many redirects')); return; }
      const parsed = new URL(u);
      const lib    = parsed.protocol === 'https:' ? https : http;
      lib.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetch(new URL(res.headers.location, u).href);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error',  (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    };
    fetch(imageUrl);
  });
}

// ── CSV parser (RFC 4180) ─────────────────────────────────────────────────────

function parseCsv(raw) {
  const rows  = [];
  let   row   = [];
  let   field = '';
  let   inQ   = false;
  let   i     = 0;

  while (i < raw.length) {
    const ch   = raw[i];
    const next = raw[i + 1];

    if (inQ) {
      if (ch === '"' && next === '"') { field += '"'; i += 2; }
      else if (ch === '"')            { inQ = false;  i++;    }
      else                            { field += ch;  i++;    }
    } else {
      if (ch === '"') {
        inQ = true; i++;
      } else if (ch === ',') {
        row.push(field); field = ''; i++;
      } else if (ch === '\r' && next === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; i += 2;
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = ''; i++;
      } else {
        field += ch; i++;
      }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g,  '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function formatDate(raw) {
  if (!raw) return '';
  // Google Forms date picker outputs M/D/YYYY or YYYY-MM-DD depending on locale.
  // Parse both by normalising slashed dates to ISO before constructing a Date.
  let iso = raw.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(iso)) {
    const [m, d, y] = iso.split('/');
    iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const dt = new Date(iso + 'T00:00:00');
  if (isNaN(dt.getTime())) return raw;
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function normaliseCategory(raw) {
  const k = (raw || '').toLowerCase().trim();
  return CATEGORY[k] ? k : 'announcement';
}

// Returns a Google Drive thumbnail URL that works for any publicly shared Drive file.
// Uses drive.google.com/thumbnail which is more reliable than lh3.googleusercontent.com for hotlinking.
function driveThumbUrl(shareUrl) {
  if (!shareUrl) return null;
  let fileId = null;
  const m1 = shareUrl.match(/\/file\/d\/([^/?#\s]+)/);
  if (m1) fileId = m1[1];
  if (!fileId) {
    const m2 = shareUrl.match(/[?&]id=([^&\s]+)/);
    if (m2) fileId = m2[1];
  }
  if (!fileId) return null;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`;
}

function rowsToItems(rows) {
  return rows.slice(1).map(row => ({
    timestamp: (row[0] || '').trim(),
    title:     (row[1] || '').trim(),
    category:  (row[2] || '').trim(),
    dateRaw:   (row[3] || '').trim(),
    excerpt:   (row[4] || '').trim(),
    imageUrl:  (row[5] || '').trim(),
    published: (row[6] || '').trim().toLowerCase(),
  }));
}

// ── Overrides ─────────────────────────────────────────────────────────────────
//
// news-overrides.json lets the repo correct the sheet without needing edit
// access to it. Titles are matched exactly, ignoring case and surrounding
// whitespace. Shape:
//
//   {
//     "suppress": ["Test"],                       // drop these rows entirely
//     "images":   { "Some title": "assets/x.jpg" }, // replace the row's image
//     "extra":    [ { title, category, date, excerpt, body[], imageUrl,
//                     timestamp } ]               // posts the sheet lacks
//   }
//
// Anything here wins over the sheet. Remove an entry and the sheet takes over
// again on the next run.

const normTitle = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function loadOverrides() {
  const empty = { suppress: new Set(), images: new Map(), extra: [] };
  if (!fs.existsSync(OVERRIDES)) return empty;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(OVERRIDES, 'utf8'));
  } catch (err) {
    // A malformed overrides file must not silently publish suppressed posts.
    console.error('news-overrides.json is not valid JSON: ' + err.message);
    process.exit(1);
  }

  const suppress = new Set((raw.suppress || []).map(normTitle));
  const images   = new Map(Object.entries(raw.images || {}).map(([k, v]) => [normTitle(k), v]));
  const extra    = (raw.extra || []).map(e => ({
    timestamp: (e.timestamp || '').trim(),
    title:     (e.title     || '').trim(),
    category:  (e.category  || '').trim(),
    dateRaw:   (e.date      || '').trim(),
    excerpt:   (e.excerpt   || '').trim(),
    imageUrl:  (e.imageUrl  || '').trim(),
    body:      Array.isArray(e.body)    ? e.body    : null,
    gallery:   Array.isArray(e.gallery) ? e.gallery : null,
    published: '',
  })).filter(e => e.title.length > 0);

  return { suppress, images, extra };
}

function applyOverrides(items, ov) {
  const kept = items.filter(item => {
    if (ov.suppress.has(normTitle(item.title))) {
      console.log(`  suppressed by overrides: "${item.title}"`);
      return false;
    }
    return true;
  });

  for (const item of kept) {
    const img = ov.images.get(normTitle(item.title));
    if (img) {
      // Route through the existing local:/URL handling below.
      item.imageUrl = /^https?:/.test(img) ? img : 'local:' + img;
      console.log(`  image overridden for "${item.title}" -> ${img}`);
    }
  }

  for (const e of ov.extra) {
    if (kept.some(i => normTitle(i.title) === normTitle(e.title))) {
      console.log(`  extra "${e.title}" also came from the sheet — using the sheet row`);
      continue;
    }
    kept.push(e);
    console.log(`  added from overrides: "${e.title}"`);
  }

  return kept;
}

// ── Article page generator ────────────────────────────────────────────────────

function articleFilename(item) {
  return `news-${slugify(item.title)}.html`;
}

// Article body: an explicit body[] from the overrides file, otherwise the
// excerpt split on blank lines. Form submissions often contain several
// paragraphs, which used to render as one run-on <p>.
function bodyParagraphs(item) {
  const source = item.body && item.body.length
    ? item.body
    : String(item.excerpt || '').split(/\r?\n\s*\r?\n/);
  return source
    .map(s => String(s).trim())
    .filter(Boolean)
    .map(s => `          <p>${escapeHtml(s).replace(/\r?\n/g, '<br />')}</p>`)
    .join('\n');
}

// Optional extra photos below the article body. Images keep their natural
// aspect ratio: these come in portrait and landscape together, and forcing a
// uniform tile crops whatever the photographer framed.
function galleryHtml(item) {
  const imgs = (item._gallery || []);
  if (!imgs.length) return '';
  const tiles = imgs.map((src, i) => `          <img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)} — photo ${i + 2}" style="width:100%;height:auto;border-radius:var(--radius-lg);display:block;" loading="lazy" />`).join('\n');
  return `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:var(--space-4);margin-top:var(--space-8);">
${tiles}
        </div>`;
}

function generateArticlePage(item) {
  const cat      = normaliseCategory(item.category);
  const meta     = CATEGORY[cat];
  const title    = escapeHtml(item.title);
  // Newlines in a meta description break the tag across lines; collapse them.
  const excerpt  = escapeHtml(String(item.excerpt || '').replace(/\s+/g, ' ').trim().slice(0, 300));
  const bodyHtml = bodyParagraphs(item);
  const gallery  = galleryHtml(item);
  const date     = formatDate(item.dateRaw);
  const imgSrc   = escapeHtml(item._localImg || PLACEHOLDER);
  const bgImg    = imgSrc.startsWith('http') ? imgSrc : imgSrc;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${excerpt}" />
  <title>${title} — D.D Sports Management Agency</title>

  <link rel="icon" type="image/jpeg" href="assets/logo/dd-logo.jpg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://unpkg.com/aos@2.3.4/dist/aos.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" />
  <link rel="stylesheet" href="css/variables.css" />
  <link rel="stylesheet" href="css/global.css" />
  <link rel="stylesheet" href="css/components.css" />
  <link rel="stylesheet" href="css/animations.css" />
</head>
<body>

  <!-- NAVBAR -->
  <nav class="navbar">
    <div class="navbar-inner">
      <a href="index.html" class="navbar-logo">
        <img src="assets/logo/dd-logo.jpg" alt="D.D Sports Management Logo" />
        <div class="navbar-logo-text">
          <span class="navbar-logo-name">D.D Sports Management</span>
          <span class="navbar-logo-tagline">Confía en tu Destino</span>
        </div>
      </a>
      <ul class="navbar-links">
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="players.html">Players</a></li>
        <li><a href="services.html">Services</a></li>
        <li><a href="news.html">News</a></li>
        <li><a href="contact.html">Contact</a></li>
      </ul>
      <div class="navbar-cta">
        <a href="contact.html" class="btn btn-primary btn-sm">Get Signed</a>
      </div>
      <button class="hamburger" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </nav>

  <div class="mobile-nav">
    <ul class="mobile-nav-links">
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
      <li><a href="players.html">Players</a></li>
      <li><a href="services.html">Services</a></li>
      <li><a href="news.html">News</a></li>
      <li><a href="contact.html">Contact</a></li>
    </ul>
    <a href="contact.html" class="btn btn-primary btn-lg">Get Signed</a>
    <div class="mobile-nav-social">
      <a href="https://www.instagram.com/ddsportsmanagementagency?igsh=b3FidjN4ZDg2Yzlv" target="_blank"><i class="fa-brands fa-instagram"></i></a>
      <a href="https://www.linkedin.com/in/donte-dorlly-9b1210306/" target="_blank"><i class="fa-brands fa-linkedin"></i></a>
    </div>
  </div>


  <!-- PAGE HERO -->
  <header class="page-hero" style="padding-top:var(--nav-height);">
    <div class="page-hero-bg" style="background-image:url('${bgImg}');"></div>
    <div class="container">
      <div class="page-hero-content">
        <p class="page-hero-eyebrow">${meta.label}</p>
        <h1 class="page-hero-title">${title}</h1>
        <div class="breadcrumb">
          <a href="index.html">Home</a>
          <span class="breadcrumb-sep"><i class="fa-solid fa-chevron-right"></i></span>
          <a href="news.html">News</a>
          <span class="breadcrumb-sep"><i class="fa-solid fa-chevron-right"></i></span>
          <span>${meta.label}</span>
        </div>
      </div>
    </div>
  </header>


  <!-- ARTICLE -->
  <section class="section">
    <div class="container" style="max-width:800px;">

      <div data-aos="fade-up" style="margin-bottom:var(--space-8);">
        <div style="display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;margin-bottom:var(--space-6);">
          <span class="badge ${meta.badge}">${meta.label}</span>
          <p style="font-size:var(--text-sm);color:var(--gray-400);margin:0;">
            <i class="fa-regular fa-calendar"></i> ${date}
          </p>
        </div>

        <h1 style="font-family:var(--font-display);font-size:clamp(var(--text-2xl),4vw,var(--text-4xl));color:var(--white);line-height:var(--leading-tight);margin-bottom:var(--space-6);">
          ${title}
        </h1>

        <img src="${imgSrc}" alt="${title}" style="width:100%;border-radius:var(--radius-xl);margin-bottom:var(--space-8);object-fit:cover;max-height:480px;" loading="lazy" />

        <div style="font-size:var(--text-base);color:var(--gray-300);line-height:var(--leading-loose);display:flex;flex-direction:column;gap:var(--space-4);">
${bodyHtml}
        </div>${gallery}
      </div>

      <div data-aos="fade-up" style="border-top:1px solid var(--gray-800);padding-top:var(--space-8);">
        <a href="news.html" class="btn btn-outline"><i class="fa-solid fa-arrow-left"></i> Back to News</a>
      </div>

    </div>
  </section>


  <!-- FOOTER -->
  <footer class="footer">
    <div class="container">
      <div class="footer-main">
        <div>
          <img class="footer-brand-logo" src="assets/logo/dd-logo.jpg" alt="D.D Sports Management" />
          <p class="footer-brand-tagline">Confía en tu Destino</p>
          <p style="color:var(--gray-400);font-size:var(--text-xs);line-height:var(--leading-loose);font-style:italic;margin-bottom:var(--space-4);">"Success is no accident. It is hard work, perseverance, learning, studying, sacrifice, and most of all, love of what you are doing or learning to do." — Pelé</p>
          <p class="footer-brand-text">FIFA Licensed football agency representing elite players and coaches globally.</p>
          <div class="footer-social">
            <a href="https://www.instagram.com/ddsportsmanagementagency?igsh=b3FidjN4ZDg2Yzlv" aria-label="Instagram" target="_blank"><i class="fa-brands fa-instagram"></i></a>
            <a href="https://www.linkedin.com/in/donte-dorlly-9b1210306/" aria-label="LinkedIn" target="_blank"><i class="fa-brands fa-linkedin"></i></a>
            <a href="https://wa.me/27711191480" aria-label="WhatsApp" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-whatsapp"></i></a>
          </div>
        </div>
        <div>
          <h4 class="footer-col-title">Navigation</h4>
          <ul class="footer-links">
            <li><a href="index.html">Home</a></li>
            <li><a href="about.html">About</a></li>
            <li><a href="players.html">Players</a></li>
            <li><a href="services.html">Services</a></li>
            <li><a href="news.html">News</a></li>
            <li><a href="contact.html">Contact</a></li>
          </ul>
        </div>
        <div>
          <h4 class="footer-col-title">Categories</h4>
          <ul class="footer-links">
            <li><a href="news.html">Transfers</a></li>
            <li><a href="news.html">Announcements</a></li>
            <li><a href="news.html">Scouting</a></li>
            <li><a href="news.html">Events</a></li>
          </ul>
        </div>
        <div>
          <h4 class="footer-col-title">Contact</h4>
          <div class="footer-contact-item"><i class="fa-solid fa-envelope"></i><span>ddsportsagency1@gmail.com</span></div>
          <div class="footer-contact-item"><i class="fa-brands fa-whatsapp"></i><span>WhatsApp Available</span></div>
          <div class="footer-contact-item"><i class="fa-solid fa-certificate"></i><span>FIFA Licensed Agent</span></div>
        </div>
      </div>
      <div class="divider-gold"></div>
      <div class="footer-bottom">
        <p class="footer-copyright">&copy; 2026 <span>D.D Sports Management Agency</span>. All rights reserved.</p>
        <div class="footer-bottom-links">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
        </div>
      </div>
    </div>
  </footer>

  <script src="https://unpkg.com/aos@2.3.4/dist/aos.js"></script>
  <script src="js/main.js"></script>
</body>
</html>`;
}

// ── Card HTML generators ──────────────────────────────────────────────────────

// A card is a fixed-height teaser: collapse any newlines from the form
// submission before truncating, or the card breaks mid-paragraph.
function cardExcerpt(item) {
  const flat = String(item.excerpt || '').replace(/\s+/g, ' ').trim();
  return escapeHtml(flat.length > 160 ? flat.slice(0, 157) + '…' : flat);
}

function homeCard(item, index) {
  const cat    = normaliseCategory(item.category);
  const meta   = CATEGORY[cat];
  const title  = escapeHtml(item.title);
  const excerpt = cardExcerpt(item);
  const date   = formatDate(item.dateRaw);
  const imgSrc = escapeHtml(item._localImg || PLACEHOLDER);
  const delay  = index * 100;
  const href   = escapeHtml(articleFilename(item));

  return `        <article class="news-card" data-aos="fade-up" data-aos-delay="${delay}">
          <div class="news-card-img">
            <img src="${imgSrc}" alt="${title}" loading="lazy" />
            <div class="news-card-tag"><span class="badge ${meta.badge}">${meta.label}</span></div>
          </div>
          <div class="news-card-body">
            <p class="news-card-date"><i class="fa-regular fa-calendar"></i> ${date}</p>
            <h3 class="news-card-title">${title}</h3>
            <p class="news-card-excerpt">${excerpt}</p>
          </div>
          <div class="news-card-footer">
            <a href="${href}" class="news-card-read">Read More <i class="fa-solid fa-arrow-right"></i></a>
          </div>
        </article>`;
}

function newsCard(item, index) {
  const cat    = normaliseCategory(item.category);
  const meta   = CATEGORY[cat];
  const title  = escapeHtml(item.title);
  const excerpt = cardExcerpt(item);
  const date   = formatDate(item.dateRaw);
  const imgSrc = escapeHtml(item._localImg || PLACEHOLDER);
  const delay  = (index % 3) * 100;
  const href   = escapeHtml(articleFilename(item));

  return `        <article class="news-card" data-category="${cat}" data-aos="fade-up" data-aos-delay="${delay}">
          <div class="news-card-img">
            <img src="${imgSrc}" alt="${title}" loading="lazy" />
            <div class="news-card-tag"><span class="badge ${meta.badge}">${meta.label}</span></div>
          </div>
          <div class="news-card-body">
            <p class="news-card-date"><i class="fa-regular fa-calendar"></i> ${date}</p>
            <h3 class="news-card-title">${title}</h3>
            <p class="news-card-excerpt">${excerpt}</p>
          </div>
          <div class="news-card-footer">
            <a href="${href}" class="news-card-read">Read More <i class="fa-solid fa-arrow-right"></i></a>
          </div>
        </article>`;
}

// ── HTML marker replacement ───────────────────────────────────────────────────

function updateMarkers(filePath, cards) {
  let html = fs.readFileSync(filePath, 'utf8');
  const si = html.indexOf(MARKER_START);
  const ei = html.indexOf(MARKER_END);
  if (si === -1 || ei === -1) {
    console.error(`  Markers not found in ${path.basename(filePath)} — skipping`);
    return;
  }
  const inner = '\n' + cards.join('\n\n') + '\n        ';
  fs.writeFileSync(filePath, html.slice(0, si + MARKER_START.length) + inner + html.slice(ei), 'utf8');
  console.log(`  ${path.basename(filePath)} updated with ${cards.length} card(s)`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!SHEET_CSV_URL) {
    console.error('GOOGLE_SHEET_CSV_URL environment variable is not set.');
    process.exit(1);
  }

  const csvUrl = SHEET_CSV_URL;
  console.log('Fetching Google Sheets CSV...');

  let response;
  try {
    response = await httpsGet(csvUrl);
  } catch (err) {
    console.error('Failed to fetch sheet:', err.message);
    process.exit(0);
  }

  if (response.status !== 200) {
    console.error(`Sheet returned HTTP ${response.status}. Is the sheet published publicly?`);
    process.exit(0);
  }

  const rows = parseCsv(response.body);
  if (rows.length < 2) {
    console.log('Sheet is empty or has only headers — nothing to publish.');
    process.exit(0);
  }

  let items = rowsToItems(rows)
    .filter(item => item.title.length > 0)
    .filter(item => item.published !== 'no');

  const overrides = loadOverrides();
  items = applyOverrides(items, overrides);

  if (items.length === 0) {
    console.log('No publishable items found — skipping HTML update.');
    process.exit(0);
  }

  // Sort newest first using timestamp column
  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  console.log(`Processing ${items.length} item(s)...`);

  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  for (const item of items) {
    // Gallery entries are repo paths only — never publish one that isn't there.
    if (item.gallery) {
      item._gallery = item.gallery.filter(g => {
        const ok = fs.existsSync(path.join(ROOT, g));
        if (!ok) console.warn(`  gallery image not found, skipping: ${g}`);
        return ok;
      });
    }

    const imageUrl = item.imageUrl;

    // local: prefix — reference an already-committed asset directly
    if (imageUrl.startsWith('local:')) {
      const localPath = imageUrl.slice(6).trim();
      if (fs.existsSync(path.join(ROOT, localPath))) {
        item._localImg = localPath;
      } else {
        console.warn(`  local: image not found: ${localPath} — using placeholder`);
        item._localImg = PLACEHOLDER;
      }
      continue;
    }

    // Google Drive share link — use CDN thumbnail URL directly, no download needed
    if (imageUrl) {
      const thumbUrl = driveThumbUrl(imageUrl);
      if (!thumbUrl) {
        console.warn(`  Cannot parse Drive URL for "${item.title}" — using placeholder`);
        item._localImg = PLACEHOLDER;
        continue;
      }
      console.log(`  Using Drive image for "${item.title}"`);
      item._localImg = thumbUrl;
      continue;
    }

    // No image URL provided
    item._localImg = PLACEHOLDER;
  }

  console.log('Generating article pages...');
  for (const item of items.slice(0, NEWS_LIMIT)) {
    const filename = articleFilename(item);
    const filePath = path.join(ROOT, filename);
    fs.writeFileSync(filePath, generateArticlePage(item), 'utf8');
    console.log(`  Generated ${filename}`);
  }

  console.log('Updating HTML...');
  updateMarkers(INDEX_HTML, items.slice(0, HOME_LIMIT).map(homeCard));
  updateMarkers(NEWS_HTML,  items.slice(0, NEWS_LIMIT).map(newsCard));
  console.log('Done.');
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(0);
});
