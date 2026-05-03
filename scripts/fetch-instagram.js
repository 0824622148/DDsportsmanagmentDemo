#!/usr/bin/env node
'use strict';

/**
 * Fetches recent posts from an Instagram Business account via the Graph API
 * and regenerates the news card sections in index.html and news.html.
 *
 * Required GitHub Secrets (Settings → Secrets → Actions):
 *   INSTAGRAM_ACCESS_TOKEN          — long-lived or System User access token
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID  — numeric Instagram Business Account ID
 *
 * Category detection: add one of these hashtags to an Instagram post caption
 * to control which filter tab it appears under on the news page:
 *   #transfer or #transfers or #signing  → Transfers tab
 *   #scouting or #scout or #recruitment  → Scouting tab
 *   #event or #events or #match          → Events tab
 *   (anything else)                      → Announcements tab (default)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const ACCOUNT_ID   = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const ROOT         = path.join(__dirname, '..');
const ASSETS_DIR   = path.join(ROOT, 'assets', 'instagram');
const INDEX_HTML   = path.join(ROOT, 'index.html');
const NEWS_HTML    = path.join(ROOT, 'news.html');
const HOME_LIMIT   = 3;
const NEWS_LIMIT   = 12;

const BADGE_LABEL = {
  transfer:     'Transfer',
  announcement: 'Announcement',
  scouting:     'Scouting',
  event:        'Event',
};

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsGet(requestUrl) {
  return new Promise((resolve, reject) => {
    const fetch = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          fetch(res.headers.location);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    fetch(requestUrl);
  });
}

function downloadImage(imageUrl, destPath) {
  return new Promise((resolve, reject) => {
    const fetch = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          fetch(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      }).on('error', reject);
    };
    fetch(imageUrl);
  });
}

// ── Caption helpers ───────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(s) {
  return s.replace(/#\S+/g, '').replace(/@\S+/g, '').replace(/\s{2,}/g, ' ').trim();
}

function parseCaption(caption) {
  if (!caption) return { title: 'New Post', excerpt: 'View this post on Instagram.' };
  const lines = caption.split('\n').map(l => l.trim()).filter(Boolean);
  let title = stripTags(lines[0]) || 'New Post';
  if (title.length > 72) title = title.slice(0, 69) + '…';
  const body = lines.slice(1).map(stripTags).filter(Boolean).join(' ');
  let excerpt = body || stripTags(lines[0]);
  if (excerpt.length > 160) excerpt = excerpt.slice(0, 157) + '…';
  return { title, excerpt };
}

function detectCategory(caption) {
  if (!caption) return 'announcement';
  const t = caption.toLowerCase();
  if (/#transfer|#transfers|#signing|#signed|#deal|#move/.test(t)) return 'transfer';
  if (/#scout|#scouting|#talent|#recruitment/.test(t)) return 'scouting';
  if (/#event|#events|#match|#game|#tournament/.test(t)) return 'event';
  return 'announcement';
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ── Card HTML generators ─────────────────────────────────────────────────────

function homeCard(post, i) {
  const { title, excerpt } = parseCaption(post.caption);
  const badge = BADGE_LABEL[detectCategory(post.caption)];
  const date  = formatDate(post.timestamp);
  const src   = `assets/instagram/${post.id}.jpg`;

  return `        <article class="news-card" data-aos="fade-up" data-aos-delay="${i * 100}">
          <div class="news-card-img">
            <img src="${src}" alt="${escapeHtml(title)}" loading="lazy" />
            <div class="news-card-tag"><span class="badge badge-outline">${badge}</span></div>
          </div>
          <div class="news-card-body">
            <p class="news-card-date"><i class="fa-regular fa-calendar"></i> ${date}</p>
            <h3 class="news-card-title">${escapeHtml(title)}</h3>
            <p class="news-card-excerpt">${escapeHtml(excerpt)}</p>
          </div>
          <div class="news-card-footer">
            <a href="${post.permalink}" class="news-card-read" target="_blank" rel="noopener">View Post <i class="fa-brands fa-instagram"></i></a>
          </div>
        </article>`;
}

function newsCard(post, i) {
  const { title, excerpt } = parseCaption(post.caption);
  const cat   = detectCategory(post.caption);
  const badge = BADGE_LABEL[cat];
  const date  = formatDate(post.timestamp);
  const src   = `assets/instagram/${post.id}.jpg`;

  return `        <article class="news-card" data-category="${cat}" data-aos="fade-up" data-aos-delay="${(i % 3) * 100}">
          <div class="news-card-img">
            <img src="${src}" alt="${escapeHtml(title)}" loading="lazy" />
            <div class="news-card-tag"><span class="badge badge-outline">${badge}</span></div>
          </div>
          <div class="news-card-body">
            <p class="news-card-date"><i class="fa-regular fa-calendar"></i> ${date}</p>
            <h3 class="news-card-title">${escapeHtml(title)}</h3>
            <p class="news-card-excerpt">${escapeHtml(excerpt)}</p>
          </div>
          <div class="news-card-footer">
            <a href="${post.permalink}" class="news-card-read" target="_blank" rel="noopener">View Post <i class="fa-brands fa-instagram"></i></a>
          </div>
        </article>`;
}

// ── HTML marker replacement ───────────────────────────────────────────────────

function updateMarkers(filePath, cards) {
  const START = '<!-- INSTAGRAM-NEWS-START -->';
  const END   = '<!-- INSTAGRAM-NEWS-END -->';
  let html = fs.readFileSync(filePath, 'utf8');
  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si === -1 || ei === -1) {
    console.error(`Markers not found in ${path.basename(filePath)} — skipping`);
    return;
  }
  const inner = '\n' + cards.join('\n\n') + '\n        ';
  fs.writeFileSync(filePath, html.slice(0, si + START.length) + inner + html.slice(ei), 'utf8');
  console.log(`  ${path.basename(filePath)} — updated with ${cards.length} card(s)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!ACCESS_TOKEN || !ACCOUNT_ID) {
    console.error('INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID must be set');
    process.exit(1);
  }

  const apiUrl = 'https://graph.facebook.com/v19.0/' + ACCOUNT_ID + '/media'
    + '?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
    + '&limit=' + NEWS_LIMIT
    + '&access_token=' + ACCESS_TOKEN;

  console.log('Fetching Instagram posts...');
  let data;
  try {
    data = JSON.parse(await httpsGet(apiUrl));
  } catch (err) {
    console.error('API request failed:', err.message);
    process.exit(0);
  }

  if (data.error) {
    console.error('Instagram API error:', data.error.message);
    process.exit(0);
  }

  const posts = (data.data || []).filter(p => p.media_type !== 'STORY');
  console.log(`Received ${posts.length} post(s)`);

  if (posts.length === 0) {
    console.log('Nothing to update');
    process.exit(0);
  }

  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  console.log('Downloading images...');
  for (const post of posts) {
    const imgUrl = post.media_type === 'VIDEO' ? post.thumbnail_url : post.media_url;
    const dest   = path.join(ASSETS_DIR, `${post.id}.jpg`);
    if (imgUrl && !fs.existsSync(dest)) {
      try {
        await downloadImage(imgUrl, dest);
        console.log(`  Downloaded ${post.id}.jpg`);
      } catch (err) {
        console.error(`  Failed to download ${post.id}: ${err.message}`);
        post._skipImage = true;
      }
    }
  }

  const valid = posts.filter(
    p => !p._skipImage && fs.existsSync(path.join(ASSETS_DIR, `${p.id}.jpg`))
  );

  if (valid.length === 0) {
    console.log('No posts with usable images — skipping HTML update');
    process.exit(0);
  }

  console.log('Updating HTML...');
  updateMarkers(INDEX_HTML, valid.slice(0, HOME_LIMIT).map(homeCard));
  updateMarkers(NEWS_HTML,  valid.slice(0, NEWS_LIMIT).map(newsCard));
  console.log('Done.');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(0);
});
