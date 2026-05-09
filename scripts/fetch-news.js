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

// Returns a Google CDN thumbnail URL that works for any publicly shared Drive file.
// No download needed — the img src points directly to Google's servers.
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
  return `https://lh3.googleusercontent.com/d/${fileId}`;
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

// ── Card HTML generators ──────────────────────────────────────────────────────

function homeCard(item, index) {
  const cat    = normaliseCategory(item.category);
  const meta   = CATEGORY[cat];
  const title  = escapeHtml(item.title);
  const excerpt = escapeHtml(
    item.excerpt.length > 160 ? item.excerpt.slice(0, 157) + '…' : item.excerpt
  );
  const date   = formatDate(item.dateRaw);
  const imgSrc = escapeHtml(item._localImg || PLACEHOLDER);
  const delay  = index * 100;

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
            <a href="news.html" class="news-card-read">Read More <i class="fa-solid fa-arrow-right"></i></a>
          </div>
        </article>`;
}

function newsCard(item, index) {
  const cat    = normaliseCategory(item.category);
  const meta   = CATEGORY[cat];
  const title  = escapeHtml(item.title);
  const excerpt = escapeHtml(
    item.excerpt.length > 160 ? item.excerpt.slice(0, 157) + '…' : item.excerpt
  );
  const date   = formatDate(item.dateRaw);
  const imgSrc = escapeHtml(item._localImg || PLACEHOLDER);
  const delay  = (index % 3) * 100;

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
            <a href="news.html" class="news-card-read">Read More <i class="fa-solid fa-arrow-right"></i></a>
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

  if (items.length === 0) {
    console.log('No publishable items found — skipping HTML update.');
    process.exit(0);
  }

  // Sort newest first using timestamp column
  items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  console.log(`Processing ${items.length} item(s)...`);

  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  for (const item of items) {
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

  console.log('Updating HTML...');
  updateMarkers(INDEX_HTML, items.slice(0, HOME_LIMIT).map(homeCard));
  updateMarkers(NEWS_HTML,  items.slice(0, NEWS_LIMIT).map(newsCard));
  console.log('Done.');
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(0);
});
