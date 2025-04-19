import fs from 'fs/promises';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent'; // Import đúng cách
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  proxies: ['http://45.140.143.77:18080'], // Thêm proxy nếu cần, ví dụ: ['http://123.45.67.89:8080']
  maxRetries: 5, // Tăng số lần thử
  retryDelay: 3000, // Tăng delay
  timeout: 15000, // Tăng timeout
  clusters: [
    {
      input: path.join(__dirname, 'cumdauvao1.txt'),
      output: path.join(__dirname, 'cumdaura1.xml'),
      title: 'Merged Feed 1',
      link: 'https://example.com/feed1',
      description: 'RSS feed merged from source 1'
    }
    // {
    //   input: path.join(__dirname, 'cumdauvao2.txt'),
    //   output: path.join(__dirname, 'cumdaura2.xml'),
    //   title: 'Merged Feed 2',
    //   link: 'https://example.com/feed2',
    //   description: 'RSS feed merged from source 2'
    // },
    // {
    //   input: path.join(__dirname, 'cumdauvao3.txt'),
    //   output: path.join(__dirname, 'cumdaura3.xml'),
    //   title: 'Merged Feed 3',
    //   link: 'https://example.com/feed3',
    //   description: 'RSS feed merged from source 3'
    // }
  ]
};

const parser = new Parser();

function getRandomHeader() {
  return CONFIG.headers[Math.floor(Math.random() * CONFIG.headers.length)];
}

async function fetchWithBypass(url, retryCount = 0, proxyIndex = 0) {
  try {
    const config = {
      headers: getRandomHeader(),
      timeout: CONFIG.timeout
    };

    // Chỉ dùng proxy nếu proxies không trống và proxyIndex hợp lệ
    if (CONFIG.proxies.length > 0 && proxyIndex < CONFIG.proxies.length) {
      config.httpsAgent = new HttpsProxyAgent(CONFIG.proxies[proxyIndex]);
      console.log(`Using proxy: ${CONFIG.proxies[proxyIndex]}`);
    }

    const response = await axios.get(url, config);
    const feed = await parser.parseString(response.data);
    return feed;
  } catch (err) {
    if (err.response && err.response.status === 403 && retryCount < CONFIG.maxRetries) {
      console.warn(`⚠️ 403 Forbidden for ${url}, retrying (${retryCount + 1}/${CONFIG.maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return fetchWithBypass(url, retryCount + 1, proxyIndex);
    } else if (err.response && err.response.status === 403 && proxyIndex < CONFIG.proxies.length - 1) {
      console.warn(`⚠️ Switching to next proxy for ${url}...`);
      return fetchWithBypass(url, 0, proxyIndex + 1);
    }
    console.error(`❌ Error fetching ${url}: ${err.message}`);
    return null;
  }
}

async function checkFile(filePath, type = 'input') {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    console.error(`❌ ${type} file ${filePath} does not exist or is inaccessible`);
    return false;
  }
}

async function processCluster({ input, output, title, link, description }) {
  console.log(`📋 Processing cluster: ${input} -> ${output}`);
  try {
    if (!(await checkFile(input, 'Input'))) {
      return;
    }

    let urls = [];
    try {
      const fileContent = await fs.readFile(input, 'utf-8');
      urls = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
      console.log(`📄 Found ${urls.length} URLs in ${input}`);
    } catch (err) {
      console.error(`❌ Error reading ${input}: ${err.message}`);
      return;
    }

    const allItems = [];

    for (const url of urls) {
      const feed = await fetchWithBypass(url);
      if (feed && feed.items) {
        allItems.push(...feed.items);
        console.log(`✅ Fetched ${url} (${feed.items.length} items)`);
      }
    }

    if (allItems.length === 0) {
      console.warn(`⚠️ No items fetched for cluster ${input}`);
      return;
    }

    allItems.sort((a, b) => {
      const dateA = a.pubDate ? new Date(a.pubDate) : new Date(0);
      const dateB = b.pubDate ? new Date(b.pubDate) : new Date(0);
      return dateB - dateA;
    });

    const builder = new XMLBuilder({ ignoreAttributes: false });
    const xml = builder.build({
      rss: {
        '@_version': '2.0',
        channel: {
          title: title || `Merged Feed from ${path.basename(input)}`,
          link: link || 'https://example.com',
          description: description || 'RSS feed merged from sources',
          language: 'en',
          item: allItems.map(item => ({
            title: item.title || 'No title',
            link: item.link?.replace('nitter.poast.org', 'x.com') || item.guid || 'No link',
            pubDate: item.pubDate || new Date().toISOString(),
            guid: item.guid || item.link || 'No guid',
            description: item.content || item.summary || 'No description'
          }))
        }
      }
    });

    try {
      await fs.writeFile(output, xml);
      console.log(`✅ Created ${output} with ${allItems.length} items`);
    } catch (err) {
      console.error(`❌ Error writing ${output}: ${err.message}`);
    }
  } catch (err) {
    console.error(`❌ Error processing cluster ${input}: ${err.message}`);
  }
}

async function main() {
  console.log('🚀 Starting RSS merge process...');
  try {
    console.log('🔍 Checking environment...');
    console.log(`Node.js version: ${process.version}`);

    if (!CONFIG.clusters.length) {
      throw new Error('No clusters defined in CONFIG');
    }

    for (const cluster of CONFIG.clusters) {
      await processCluster(cluster);
    }
    console.log('🏁 RSS merge process completed.');
  } catch (err) {
    console.error(`❌ Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
