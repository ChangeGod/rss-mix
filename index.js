import fs from 'fs/promises';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, 'source');

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
  proxies: ['http://45.140.143.77:18080'],
  maxRetries: 5,
  retryDelay: 3000,
  timeout: 15000
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

    let feedSources = [];
    try {
      const fileContent = await fs.readFile(input, 'utf-8');
      feedSources = fileContent
        .split('\n')
        .map(line => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return null;

          // Extract URL and source label (if present)
          const match = trimmedLine.match(/^(https:\/\/[^\s]+)(?:\s*\(([^)]+)\))?$/);
          if (!match) {
            console.warn(`⚠️ Invalid line format in ${input}: ${trimmedLine}`);
            return null;
          }

          return {
            url: match[1],
            sourceLabel: match[2] || null // e.g., "From Walter Bloomberg" or null
          };
        })
        .filter(Boolean);
      console.log(`📄 Found ${feedSources.length} URLs in ${input}`);
    } catch (err) {
      console.error(`❌ Error reading ${input}: ${err.message}`);
      return;
    }

    const allItems = [];

    for (const { url, sourceLabel } of feedSources) {
      const feed = await fetchWithBypass(url);
      if (feed && feed.items) {
        // Add the sourceLabel to each item
        const itemsWithSource = feed.items.map(item => ({
          ...item,
          sourceLabel // Attach the source label to the item
        }));
        allItems.push(...itemsWithSource);
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
            title: item.sourceLabel
              ? `${item.title || 'No title'} (${item.sourceLabel})` // Append source label to title
              : item.title || 'No title',
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

async function generateClusters() {
  try {
    const files = await fs.readdir(SOURCE_DIR);
    const txtFiles = files.filter(f => f.match(/^cumdauvao\d+\.txt$/));

    if (txtFiles.length === 0) {
      throw new Error(`No cumdauvao*.txt files found in ${SOURCE_DIR}`);
    }

    return txtFiles.map(file => {
      const number = file.match(/\d+/)?.[0] || '1';
      return {
        input: path.join(SOURCE_DIR, file),
        output: path.join(__dirname, `cumdaura${number}.xml`),
        title: `Merged Feed ${number}`,
        link: `https://example.com/feed${number}`,
        description: `RSS feed merged from source ${number}`
      };
    });
  } catch (err) {
    console.error(`❌ Error reading directory ${SOURCE_DIR}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log('🚀 Starting RSS merge process...');
  try {
    console.log('🔍 Checking environment...');
    console.log(`Node.js version: ${process.version}`);

    const clusters = await generateClusters();
    if (!clusters.length) {
      throw new Error('No valid clusters to process');
    }

    for (const cluster of clusters) {
      await processCluster(cluster);
    }
    console.log('🏁 RSS merge process completed.');
  } catch (err) {
    console.error(`❌ Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
