import fs from 'fs/promises';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';

// ---------------------------------------------------------------------------
// 🔐 1. Environment variables (set via GitHub Secrets or local .env)
// ---------------------------------------------------------------------------
const BASE_URL_LOCAL   = process.env.BASE_URL_LOCAL   || '';   // 
const API_USERNAME     = process.env.API_USERNAME     || '';
const API_PASSWORD     = process.env.API_PASSWORD     || '';

const PROXY_LOCAL_URL  = process.env.PROXY_LOCAL_URL  || '';   // 
const RSS_KEY_SECRET   = process.env.RSS_KEY_SECRET   || '';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, 'source');        // cumdauvao*.txt
const NAME_DIR   = path.join(__dirname, 'name');          // name*.txt (cluster titles)

// ---------------------------------------------------------------------------
// ⚙️ 2. Default config (headers, proxy pool, retry…)
// ---------------------------------------------------------------------------
const CONFIG = {
  headers: [
    {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
      'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive'
    },
    {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive'
    },
    {
      'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0',
      'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection': 'keep-alive'
    }
  ],
  proxies: PROXY_LOCAL_URL ? [PROXY_LOCAL_URL] : [],
  maxRetries: 5,
  retryDelay: 3000,
  timeout: 15000
};

const parser = new Parser();

// ---------------------------------------------------------------------------
// 🛠️ 3. Helper functions
// ---------------------------------------------------------------------------
const getRandomHeader = () => CONFIG.headers[Math.floor(Math.random() * CONFIG.headers.length)];

/**
 * Replace {{BASE_URL_LOCAL}} placeholder and append `/rss?key=...` automatically.
 */
function resolvePlaceholders(rawUrl) {
  if (!BASE_URL_LOCAL) return rawUrl;

  let resolved = rawUrl.replace(/\{\{\s*BASE_URL_LOCAL\s*}}/g, BASE_URL_LOCAL);

  // Append /rss?key=… if not present already
  if (!/\/rss\?key=/.test(resolved)) {
    resolved = resolved.replace(/\/?$/, ''); // strip possible trailing slash
    resolved = `${resolved}/rss?key=${RSS_KEY_SECRET}`;
  }
  return resolved;
}

/**
 * Build Axios configuration (headers + proxy + basic‑auth if required).
 */
function buildAxiosConfig(targetUrl, proxyIndex = 0) {
  const cfg = {
    headers: getRandomHeader(),
    timeout: CONFIG.timeout
  };

  // Basic‑Auth for local API
  if (BASE_URL_LOCAL && targetUrl.startsWith(BASE_URL_LOCAL) && API_USERNAME && API_PASSWORD) {
    cfg.auth = { username: API_USERNAME, password: API_PASSWORD };
  }

  // Proxy only for local API (as requested)
  if (targetUrl.startsWith(BASE_URL_LOCAL) && CONFIG.proxies.length && proxyIndex < CONFIG.proxies.length) {
    cfg.httpsAgent = new HttpsProxyAgent(CONFIG.proxies[proxyIndex]);
    console.log(`🛡️  Using proxy: ${CONFIG.proxies[proxyIndex]} → ${targetUrl}`);
  }

  return cfg;
}

// ---------------------------------------------------------------------------
// 🚚 4. Fetch RSS with retry & (optional) proxy rotation
// ---------------------------------------------------------------------------
async function fetchWithBypass(url, retryCount = 0, proxyIndex = 0) {
  try {
    const response = await axios.get(url, buildAxiosConfig(url, proxyIndex));
    return await parser.parseString(response.data);
  } catch (err) {
    const status = err.response?.status;
    // Only rotate proxies for local API
    if (status === 403 && url.startsWith(BASE_URL_LOCAL) && proxyIndex < CONFIG.proxies.length - 1) {
      console.warn(`⚠️ 403 → switching proxy (${proxyIndex + 1}/${CONFIG.proxies.length})…`);
      return fetchWithBypass(url, 0, proxyIndex + 1);
    }
    if (retryCount < CONFIG.maxRetries) {
      console.warn(`⚠️ ${status || err.code} for ${url}, retry ${retryCount + 1}/${CONFIG.maxRetries}`);
      await new Promise(r => setTimeout(r, CONFIG.retryDelay));
      return fetchWithBypass(url, retryCount + 1, proxyIndex);
    }
    console.error(`❌ Failed ${url}: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 📂 5.  Utilities for I/O
// ---------------------------------------------------------------------------
async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function getTitleForCluster(num) {
  const nameFile = path.join(NAME_DIR, `name${num}.txt`);
  if (await fileExists(nameFile)) {
    return (await fs.readFile(nameFile, 'utf8')).trim() || 'No name';
  }
  return 'No name';
}

// ---------------------------------------------------------------------------
// 🔄 6.  Process one cluster (cumdauvao*.txt → cumdaura*.xml)
// ---------------------------------------------------------------------------
async function processCluster({ input, output, title, link, description }) {
  console.log(`\n📦 ${path.basename(input)} → ${path.basename(output)}`);

  if (!(await fileExists(input))) {
    console.error(`❌ Input file missing: ${input}`);
    return;
  }

  // 1️⃣ Read URLs & optional labels
  const lines = (await fs.readFile(input, 'utf8')).split(/\r?\n/).filter(Boolean);
  const feedSources = lines.map(l => {
    const match = l.trim().match(/^(https?:\/\/[^\s]+)(?:\s*\(([^)]+)\))?$/);
    if (!match) {
      console.warn(`⚠️ Invalid line: ${l}`);
      return null;
    }
    return { url: resolvePlaceholders(match[1]), sourceLabel: match[2] || null };
  }).filter(Boolean);

  // 2️⃣ Fetch & merge items
  const allItems = [];
  for (const { url, sourceLabel } of feedSources) {
    const feed = await fetchWithBypass(url);
    if (feed?.items?.length) {
      allItems.push(...feed.items.map(i => ({ ...i, sourceLabel })));
      console.log(`   • ${url}  (${feed.items.length})`);
    }
  }
  if (!allItems.length) {
    console.warn(`⚠️ No items fetched for ${input}`);
    return;
  }

  // 3️⃣ Sort by date (desc)
  allItems.sort((a,b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  // 4️⃣ Build RSS XML
  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  const xml = builder.build({
    rss: {
      '@_version': '2.0',
      channel: {
        title,
        link,
        description,
        language: 'en',
        item: allItems.map(it => ({
          title: it.sourceLabel ? `${it.title || 'No title'} (${it.sourceLabel})` : (it.title || 'No title'),
          link: it.link?.replace('nitter.poast.org', 'x.com') || it.guid || 'No link',
          pubDate: it.pubDate || new Date().toUTCString(),
          guid: it.guid || it.link || undefined,
          description: it.content || it.summary || undefined
        }))
      }
    }
  });

  await fs.writeFile(output, xml);
  console.log(`✅ ${output} (${allItems.length} items)`);
}

// ---------------------------------------------------------------------------
// 🚀 7.  Generate cluster list & run
// ---------------------------------------------------------------------------
async function generateClusters() {
  const files = (await fs.readdir(SOURCE_DIR)).filter(f => /^cumdauvao\d+\.txt$/.test(f));
  if (!files.length) throw new Error(`No cumdauvao*.txt in ${SOURCE_DIR}`);
  return Promise.all(files.map(async f => {
    const num = f.match(/\d+/)[0];
    return {
      input: path.join(SOURCE_DIR, f),
      output: path.join(__dirname, `cumdaura${num}.xml`),
      title: await getTitleForCluster(num),
      link: `https://example.com/feed${num}`,
      description: `RSS feed merged from source ${num}`
    };
  }));
}

(async function main() {
  console.log('\n🚀 Merge RSS clusters…');
  try {
    if (!(await fileExists(NAME_DIR))) await fs.mkdir(NAME_DIR, { recursive: true });

    const clusters = await generateClusters();
    for (const c of clusters) await processCluster(c);
    console.log('\n🏁 Done');
  } catch (err) {
    console.error(`❌ Fatal: ${err.message}`);
    process.exit(1);
  }
})();
