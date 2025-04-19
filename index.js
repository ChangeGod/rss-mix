import fs from 'fs';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';

const parser = new Parser();

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0',
  'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive'
};

const clusters = [
  { input: 'cumdauvao1.txt', output: 'cumdaura1.xml' }
];

async function fetchWithBypass(url) {
  const response = await axios.get(url, { headers });
  return await parser.parseString(response.data);
}

async function processCluster(inputFile, outputFile) {
  if (!fs.existsSync(inputFile)) return;

  const urls = fs.readFileSync(inputFile, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const allItems = [];

  for (const url of urls) {
    try {
      const feed = await fetchWithBypass(url);
      allItems.push(...feed.items);
    } catch (err) {
      console.error(`❌ Error loading ${url}: ${err.message}`);
    }
  }

  allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const builder = new XMLBuilder({ ignoreAttributes: false });
  const xml = builder.build({
    rss: {
      '@_version': '2.0',
      channel: {
        title: `Merged Feed from ${inputFile}`,
        link: 'https://example.com',
        description: 'RSS feed merged from sources',
        language: 'en',
        item: allItems.map(item => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate,
          guid: item.link,
          description: item.content || item.summary || ''
        }))
      }
    }
  });

  fs.writeFileSync(outputFile, xml);
  console.log(`✅ Created ${outputFile}`);
}

(async () => {
  for (const cluster of clusters) {
    await processCluster(cluster.input, cluster.output);
  }
})();
