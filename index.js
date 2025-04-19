import fs from 'fs/promises';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import HttpsProxyAgent from 'https-proxy-agent';

// Cấu hình tổng quát
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
    }
  ],
  proxies: [
    // Thêm proxy nếu cần, ví dụ: 'http://proxy1:port'
    // Tìm proxy miễn phí tại https://free-proxy-list.net/
  ],
  maxRetries: 3,
  retryDelay: 2000, // milliseconds
  timeout: 10000, // milliseconds
  clusters: [
    { input: 'cumdauvao1.txt', output: 'cumdaura1.xml', title: 'Merged Feed 1', link: 'https://example.com/feed1', description: 'RSS feed merged from source 1' },
    // Thêm các cluster khác nếu cần
    // { input: 'cumdauvao2.txt', output: 'cumdaura2.xml', title: 'Merged Feed 2', link: 'https://example.com/feed2', description: 'RSS feed merged from source 2' }
  ]
};

const parser = new Parser();

// Lấy header ngẫu nhiên
function getRandomHeader() {
  return CONFIG.headers[Math.floor(Math.random() * CONFIG.headers.length)];
}

// Hàm lấy RSS với retry và proxy
async function fetchWithBypass(url, retryCount = 0, proxyIndex = 0) {
  try {
    const config = {
      headers: getRandomHeader(),
      timeout: CONFIG.timeout
    };

    // Sử dụng proxy nếu có
    if (CONFIG.proxies.length > proxyIndex) {
      config.httpsAgent = new HttpsProxyAgent(CONFIG.proxies[proxyIndex]);
      console.log(`Using proxy: ${CONFIG.proxies[proxyIndex]}`);
    }

    const response = await axios.get(url, config);
    return await parser.parseString(response.data);
  } catch (err) {
    if (err.response && err.response.status === 403 && retryCount < CONFIG.maxRetries) {
      console.warn(`⚠️ 403 Forbidden for ${url}, retrying (${retryCount + 1}/${CONFIG.maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return fetchWithBypass(url, retryCount + 1, proxyIndex);
    } else if (err.response && err.response.status === 403 && proxyIndex < CONFIG.proxies.length - 1) {
      console.warn(`⚠️ Switching to next proxy for ${url}...`);
      return fetchWithBypass(url, 0, proxyIndex + 1);
    }
    console.error(`❌ Error loading ${url}: ${err.message}`);
    throw err; // Để caller xử lý
  }
}

// Hàm xử lý một cluster
async function processCluster({ input, output, title, link, description }) {
  try {
    // Kiểm tra file đầu vào
    let urls = [];
    try {
      const fileContent = await fs.readFile(input, 'utf-8');
      urls = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    } catch (err) {
      console.error(`❌ Input file ${input} not found or unreadable: ${err.message}`);
      return;
    }

    const allItems = [];

    // Lấy dữ liệu từ các URL
    for (const url of urls) {
      try {
        const feed = await fetchWithBypass(url);
        allItems.push(...feed.items);
        console.log(`✅ Fetched ${url}`);
      } catch (err) {
        // Lỗi đã được log trong fetchWithBypass, tiếp tục với URL tiếp theo
      }
    }

    // Sắp xếp theo ngày xuất bản
    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Tạo XML
    const builder = new XMLBuilder({ ignoreAttributes: false });
    const xml = builder.build({
      rss: {
        '@_version': '2.0',
        channel: {
          title: title || `Merged Feed from ${input}`,
          link: link || 'https://example.com',
          description: description || 'RSS feed merged from sources',
          language: 'en',
          item: allItems.map(item => ({
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pubDate || '',
            guid: item.link || item.guid || '',
            description: item.content || item.summary || ''
          }))
        }
      }
    });

    // Lưu file
    await fs.writeFile(output, xml);
    console.log(`✅ Created ${output} with ${allItems.length} items`);
  } catch (err) {
    console.error(`❌ Error processing cluster ${input}: ${err.message}`);
  }
}

// Hàm chính
async function main() {
  console.log('🚀 Starting RSS merge process...');
  for (const cluster of CONFIG.clusters) {
    console.log(`📋 Processing cluster: ${cluster.input} -> ${cluster.output}`);
    await processCluster(cluster);
  }
  console.log('🏁 RSS merge process completed.');
}

// Chạy chương trình
main().catch(err => console.error(`❌ Fatal error: ${err.message}`));
