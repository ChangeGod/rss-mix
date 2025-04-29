import fs from 'fs/promises';
import axios from 'axios';
import Parser from 'rss-parser';
import { XMLBuilder } from 'fast-xml-parser';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fileURLToPath } from 'url';
import path from 'path';

/* ------------------------------------------------------------------
 * 1️⃣  ENVIRONMENT VARIABLES (GitHub Secrets or .env)
 * ----------------------------------------------------------------*/
const BASE_URL_LOCAL  = process.env.BASE_URL_LOCAL  || '';
const API_USERNAME    = process.env.API_USERNAME    || '';
const API_PASSWORD    = process.env.API_PASSWORD    || '';
const PROXY_LOCAL_URL = process.env.PROXY_LOCAL_URL || '';
const RSS_KEY_SECRET  = process.env.RSS_KEY_SECRET  || '';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, 'source');   // cumdauvao*.txt
const NAME_DIR   = path.join(__dirname, 'name');     // name*.txt

/* ------------------------------------------------------------------
 * 2️⃣  GLOBAL CONFIG
 * ----------------------------------------------------------------*/
const CONFIG = {
  headers: [
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0' },
    { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
    { 'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0' }
  ],
  proxies: PROXY_LOCAL_URL ? [PROXY_LOCAL_URL] : [],
  maxRetries: 5,
  retryDelay: 3000,
  timeout: 15000
};

const parser     = new Parser();
const randHeader = () => CONFIG.headers[Math.floor(Math.random()*CONFIG.headers.length)];

/* ------------------------------------------------------------------
 * 3️⃣  PLACEHOLDER ↔ URL RESOLVER
 * ----------------------------------------------------------------*/
function resolvePlaceholders(line){
  if(!line.includes('{{BASE_URL_LOCAL}}')) return line;        // no placeholder
  if(!BASE_URL_LOCAL) return null;                             // env missing

  let resolved=line.replace(/{{\s*BASE_URL_LOCAL\s*}}/g,BASE_URL_LOCAL);

  // add /rss?key=… before potential label
  const labelPos=resolved.indexOf(' (');
  const hasLabel=labelPos!==-1;
  let urlPart=hasLabel?resolved.slice(0,labelPos):resolved;
  const labelPart=hasLabel?resolved.slice(labelPos):'';

  urlPart=urlPart.replace(/\/$/,'');
  if(!urlPart.endsWith('/rss')) urlPart+='/rss';
  urlPart+=`?key=${RSS_KEY_SECRET}`;

  return urlPart+labelPart;
}

/* ------------------------------------------------------------------
 * 4️⃣  HELPERS
 * ----------------------------------------------------------------*/
const fileExists=async p=>!!(await fs.stat(p).catch(()=>false));
function toPublicLink(href){
  if(!href) return 'No link';
  let out=href.replace('nitter.poast.org','x.com');
  if(BASE_URL_LOCAL&&out.startsWith(BASE_URL_LOCAL)) out=out.replace(BASE_URL_LOCAL,'https://x.com');
  return out;
}
function buildAxiosConfig(url,idx=0){
  const cfg={headers:randHeader(),timeout:CONFIG.timeout};
  if(url.startsWith(BASE_URL_LOCAL)){
    if(API_USERNAME&&API_PASSWORD) cfg.auth={username:API_USERNAME,password:API_PASSWORD};
    if(CONFIG.proxies.length&&idx<CONFIG.proxies.length){
      cfg.httpsAgent=new HttpsProxyAgent(CONFIG.proxies[idx]);
      console.log(`🛡️  Proxy ${CONFIG.proxies[idx]} → ${url}`);
    }
  }
  return cfg;
}

async function fetchWithRetry(url,retry=0,idx=0){
  try{
    const res=await axios.get(url,buildAxiosConfig(url,idx));
    return await parser.parseString(res.data);
  }catch(err){
    const st=err.response?.status;
    if(st===403&&url.startsWith(BASE_URL_LOCAL)&&idx<CONFIG.proxies.length-1){
      console.warn(`403 → switch proxy (${idx+1})`);
      return fetchWithRetry(url,0,idx+1);
    }
    if(retry<CONFIG.maxRetries){
      console.warn(`${st||err.code} ${url} retry ${retry+1}`);
      await new Promise(r=>setTimeout(r,CONFIG.retryDelay));
      return fetchWithRetry(url,retry+1,idx);
    }
    console.error(`❌ ${url}: ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------
 * 5️⃣  MAIN PROCESS CLUSTER
 * ----------------------------------------------------------------*/
async function getTitle(no){
  const f=path.join(NAME_DIR,`name${no}.txt`);
  return (await fileExists(f))? (await fs.readFile(f,'utf8')).trim()||'No name':'No name';
}

async function processCluster({input,output,title,link,description}){
  console.log(`\n📦 ${path.basename(input)} → ${path.basename(output)}`);
  if(!(await fileExists(input))){console.error(`❌ Missing ${input}`);return;}

  const lines=(await fs.readFile(input,'utf8')).split(/\r?\n/).filter(Boolean);

  const sources=lines.map(raw=>{
    const resolved=resolvePlaceholders(raw.trim());
    if(!resolved){console.warn(`⚠️ Skip (placeholder unresolved): ${raw}`);return null;}

    // split label (at end) if exists
    let label=null, url=resolved.trim();
    const m=url.match(/^(.*) \(([^)]+)\)$/);
    if(m){ url=m[1]; label=m[2]; }
    if(!url.startsWith('http')){console.warn(`⚠️ Bad line: ${resolved}`);return null;}
    return {url,sourceLabel:label};
  }).filter(Boolean);

  const items=[];
  for(const {url,sourceLabel} of sources){
    const feed=await fetchWithRetry(url);
    if(feed?.items?.length){
      items.push(...feed.items.map(i=>({...i,sourceLabel})));
      console.log(`   • ${url} (${feed.items.length})`);
    }
  }
  if(!items.length){console.warn(`⚠️ No items for ${input}`);return;}

  items.sort((a,b)=>new Date(b.pubDate||0)-new Date(a.pubDate||0));

  const builder=new XMLBuilder({ignoreAttributes:false,format:true});
  const xml=builder.build({
    rss:{'@_version':'2.0',channel:{
      title,link,description,language:'en',
      item:items.map(it=>({
        // ➊ LABEL TRƯỚC TIÊU ĐỀ
        title: it.sourceLabel?`(${it.sourceLabel}) ${it.title||'No title'}`:(it.title||'No title'),
        link:  toPublicLink(it.link)||it.guid||'No link',
        pubDate: it.pubDate||new Date().toUTCString(),
        guid:   it.guid||it.link||undefined,
        description: it.content||it.summary||undefined
      }))
    }}});

  await fs.writeFile(output,xml);
  console.log(`✅ ${output} (${items.length})`);
}

/* ------------------------------------------------------------------
 * 6️⃣  RUN ALL CLUSTERS
 * ----------------------------------------------------------------*/
async function generateClusters(){
  const files=(await fs.readdir(SOURCE_DIR)).filter(f=>/^cumdauvao\d+\.txt$/.test(f));
  if(!files.length) throw new Error(`No cumdauvao*.txt in ${SOURCE_DIR}`);
  return Promise.all(files.map(async f=>{
    const n=f.match(/\d+/)[0];
    return {
      input:path.join(SOURCE_DIR,f),
      output:path.join(__dirname,`cumdaura${n}.xml`),
      title: await getTitle(n),
      link:`https://example.com/feed${n}`,
      description:`RSS feed merged from source ${n}`
    };
  }));
}

(async()=>{
  console.log('\n🚀 Merge RSS clusters');
  try{
    if(!(await fileExists(NAME_DIR))) await fs.mkdir(NAME_DIR,{recursive:true});
    const clusters=await generateClusters();
    for(const c of clusters) await processCluster(c);
    console.log('\n🏁 Done');
  }catch(err){
    console.error(`❌ Fatal: ${err.message}`);
    process.exit(1);
  }
})();
