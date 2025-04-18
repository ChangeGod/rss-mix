import fs from 'fs';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import fs from 'fs';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';

// Tạo parser với header giả lập trình duyệt
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0; +https://example.com/rss)'
  }
});

const clusters = [
  { input: 'cumdauvao1.txt', output: 'cumdaura1.xml' }
];

async function processCluster(inputFile, outputFile) {
  if (!fs.existsSync(inputFile)) return;

  const urls = fs.readFileSync(inputFile, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const allItems = [];

  for (const url of urls) {
    try {
      const feed = await parser.parseURL(url);
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
