import fs from 'fs/promises';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';

// ────────────────────────────────────────────────────────────────────────────
// 🔐 ENV (GitHub Secrets or .env)
// ────────────────────────────────────────────────────────────────────────────
const {
  BASE_URL_LOCAL   = '',
  API_USERNAME     = '',
  API_PASSWORD     = '',
  PROXY_LOCAL_URL  = '',
  RSS_KEY_SECRET   = '',
} = process.env;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, 'source');
const NAME_DIR   = path.join(__dirname, 'name');

// ────────────────────────────────────────────────────────────────────────────
// ⚙️  CONFIG
// ────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  headers: [
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0' },
    { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    { 'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0' },
  ],
  proxies    : PROXY_LOCAL_URL ? [PROXY_LOCAL_URL] : [],
  maxRetries : 5,
  retryDelay : 3_000,
  timeout    : 15_000,
};

const parser     = new Parser();
const randHeader = () => CONFIG.headers[Math.floor(Math.random() * CONFIG.headers.length)];

// ────────────────────────────────────────────────────────────────────────────
// 🛠  Helpers
// ────────────────────────────────────────────────────────────────────────────
function resolvePlaceholders(rawLine) {
  if (!rawLine.includes('{{BASE_URL_LOCAL}}')) return rawLine;       // public URL – keep as-is
  if (!BASE_URL_LOCAL) return null;                                 // placeholder but env missing

  let url = rawLine.replace(/{{\s*BASE_URL_LOCAL\s*}}/g, BASE_URL_LOCAL)
                   .replace(/\/$/, '');

  if (!/\/rss\?key=/.test(url)) url += `/rss?key=${RSS_KEY_SECRET}`;
  return url;
}

function toPublicLink(l) {
  if (!l) return 'No link';

  let out = l.replace('nitter.poast.org', 'x.com');

  if (BASE_URL_LOCAL && out.startsWith(BASE_URL_LOCAL)) {
    out = out.replace(BASE_URL_LOCAL, 'https://x.com');
  }

  // Bổ sung xử lý cho localhost:8080
  if (out.startsWith('http://localhost:8080')) {
    out = out.replace('http://localhost:8080', 'https://x.com');
  }

  return out;
}


function buildAxiosConfig(url, idx = 0) {
  const cfg = { headers: randHeader(), timeout: CONFIG.timeout };
  if (BASE_URL_LOCAL && url.startsWith(BASE_URL_LOCAL) && API_USERNAME && API_PASSWORD)
    cfg.auth = { username: API_USERNAME, password: API_PASSWORD };

  if (url.startsWith(BASE_URL_LOCAL) && CONFIG.proxies.length && idx < CONFIG.proxies.length) {
    cfg.httpsAgent = new HttpsProxyAgent(CONFIG.proxies[idx]);
    console.log(`🛡️  Proxy ${CONFIG.proxies[idx]} → ${url}`);
  }
  return cfg;
}

async function fetchWithRetry(url, retry = 0, idx = 0) {
  try {
    const res = await axios.get(url, buildAxiosConfig(url, idx));
    return await parser.parseString(res.data);
  } catch (err) {
    const status = err.response?.status;
    if (status === 403 && url.startsWith(BASE_URL_LOCAL) && idx < CONFIG.proxies.length - 1) {
      console.warn(`403 ➔ switch proxy idx ${idx + 1}`);
      return fetchWithRetry(url, 0, idx + 1);
    }
    if (retry < CONFIG.maxRetries) {
      console.warn(`${status || err.code} ${url} retry ${retry + 1}`);
      await new Promise(r => setTimeout(r, CONFIG.retryDelay));
      return fetchWithRetry(url, retry + 1, idx);
    }
    console.error(`❌ ${url}: ${err.message}`);
    return null;
  }
}

const fileExists = async p => !!(await fs.stat(p).catch(() => false));
const getTitle   = async n => {
  const f = path.join(NAME_DIR, `name${n}.txt`);
  return (await fileExists(f)) ? (await fs.readFile(f, 'utf8')).trim() || 'No name' : 'No name';
};

// ────────────────────────────────────────────────────────────────────────────
// 🔄 Cluster
// ────────────────────────────────────────────────────────────────────────────
async function processCluster({ input, output, title, link, description }) {
  console.log(`\n📦 ${path.basename(input)} → ${path.basename(output)}`);
  if (!(await fileExists(input))) { console.error(`❌ Missing ${input}`); return; }

  const sources = (await fs.readFile(input, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(raw => {
      const trimmed = raw.trim();

      // (Label) URL  or  URL
      let label = null;
      let urlPart = trimmed;

      const m = trimmed.match(/^\(([^)]+)\)\s+(.+)$/);
      if (m) {
        label   = m[1].trim();
        urlPart = m[2].trim();
      }

      const resolved = resolvePlaceholders(urlPart);
      if (!resolved || !resolved.startsWith('http')) {
        console.warn(`⚠️  Bad line: ${raw}`);
        return null;
      }

      return { url: resolved, sourceLabel: label };
    })
    .filter(Boolean);

  const items = [];
  for (const { url, sourceLabel } of sources) {
    const feed = await fetchWithRetry(url);
    if (feed?.items?.length) {
      items.push(...feed.items.map(i => ({ ...i, sourceLabel })));
      console.log(`   • ${url} (${feed.items.length})`);
    }
  }

  if (!items.length) { console.warn(`⚠️  No items for ${input}`); return; }

  items.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  const xml = builder.build({
    rss: {
      '@_version': '2.0',
      channel: {
        title,
        link,
        description,
        language: 'en',
        item: items.map(it => ({
          title: it.sourceLabel ? `(${it.sourceLabel}) ${it.title || 'No title'}` : it.title || 'No title',
          link : toPublicLink(it.link) || it.guid || 'No link',
          pubDate: it.pubDate || new Date().toUTCString(),
          guid: it.guid || it.link || undefined,
          description: it.content || it.summary || undefined,
        })),
      },
    },
  });

  await fs.writeFile(output, xml);
  console.log(`✅ ${output} (${items.length})`);
}

// ────────────────────────────────────────────────────────────────────────────
// 🚀 Main
// ────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🚀 Merge RSS clusters');
  if (!(await fileExists(NAME_DIR))) await fs.mkdir(NAME_DIR, { recursive: true });

  const clusters = await Promise.all(
    (await fs.readdir(SOURCE_DIR))
      .filter(f => /^cumdauvao\d+\.txt$/.test(f))
      .map(async f => {
        const n = f.match(/\d+/)[0];
        return {
          input: path.join(SOURCE_DIR, f),
          output: path.join(__dirname, `cumdaura${n}.xml`),
          title: await getTitle(n),
          link : `https://example.com/feed${n}`,
          description: `RSS feed merged from source ${n}`,
        };
      })
  );

  for (const c of clusters) await processCluster(c);
  console.log('\n🏁 Done');
}

run().catch(err => { console.error(`❌ Fatal: ${err.message}`); process.exit(1); });
