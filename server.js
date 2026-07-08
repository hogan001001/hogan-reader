const express = require('express');
const Parser = require('rss-parser');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; MyRSSReader/1.0)'
  }
});

// 支持环境变量配置数据目录（Hostinger 持久化存储）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FEEDS_FILE = path.join(DATA_DIR, 'feeds.json');
const ARTICLES_FILE = path.join(DATA_DIR, 'articles.json');

// --- 内存缓存配置 ---
const CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
const fetchCache = new Map(); // { feedId: { promise, timestamp } }

function getCachedOrFetch(feedId, fetchFn) {
  const cached = fetchCache.get(feedId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.promise;
  }
  const promise = fetchFn().finally(() => {
    // 缓存结果
    fetchCache.set(feedId, { promise: Promise.resolve(), timestamp: Date.now() });
    // 5分钟后清除缓存，允许重新抓取
    setTimeout(() => fetchCache.delete(feedId), CACHE_TTL);
  });
  fetchCache.set(feedId, { promise, timestamp: Date.now() });
  return promise;
}

// --- Popular Discovery Feeds ---
const DISCOVERY_FEEDS = [
  { id: 'dis_sspai', name: '少数派', desc: '数字生活派，实用工具与效率方法', url: 'https://sspai.com/feed', category: '科技' },
  { id: 'dis_huxiu', name: '虎嗅', desc: '深度商业科技报道', url: 'https://www.huxiu.com/rss/0.xml', category: '科技' },
  { id: 'dis_36kr', name: '36氪', desc: '新商业媒体，创业投资情报', url: 'https://36kr.com/feed', category: '科技' },
  { id: 'dis_ithome', name: 'IT之家', desc: '科技资讯与数码产品', url: 'https://www.ithome.com/rss/', category: '科技' },
  { id: 'dis_zhihudaily', name: '知乎日报', desc: '每日精选知乎高质量问答', url: 'https://daily.zhihu.com/feed', category: '社区' },
  { id: 'dis_jike', name: '即客热点', desc: '微博热搜实时聚合', url: 'https://feed.jike.ruguoapp.com/', category: '热点' },
  { id: 'dis_oddmenu', name: 'Odd Menu', desc: '独立开发者的产品与思考', url: 'https://oddmenu.top/feed', category: '产品' },
  { id: 'dis_minwt', name: 'atters', desc: '独立开发与AI工具观察', url: 'https://atters.top/feed', category: '产品' },
  { id: 'dis_jinse', name: '金色财经', desc: '区块链与加密货币资讯', url: 'https://www.jinse.com/rss', category: '财经' },
  { id: 'dis_ifeng', name: '凤凰网', desc: '综合新闻与深度报道', url: 'http://www.ruanyifeng.com/blog/atom.xml', category: '综合' },
  { id: 'dis_yuque', name: '阮一峰科技日志', desc: '科技趋势与技术分享', url: 'http://www.ruanyifeng.com/blog/atom.xml', category: '技术' },
  { id: 'dis_hackernews', name: 'Hacker News', desc: 'YC旗下科技社区热门', url: 'https://news.ycombinator.com/rss', category: '科技' },
  { id: 'dis_bbc', name: 'BBC News', desc: 'BBC英文国际新闻', url: 'https://feeds.bbci.co.uk/news/rss.xml', category: '国际' },
  { id: 'dis_reuters', name: 'Reuters', desc: '路透社全球实时新闻', url: 'https://www.reutersagency.com/feed/', category: '国际' },
  { id: 'dis_engadget', name: 'Engadget', desc: '科技数码产品资讯', url: 'https://www.engadget.com/rss.xml', category: '科技' },
  { id: 'dis_producthunt', name: 'Product Hunt', desc: '每日最新产品发布', url: 'https://www.producthunt.com/feed', category: '产品' },
  { id: 'dis_rmrb', name: '人民日报', desc: '中国权威媒体', url: 'http://paper.people.com.cn/rmrb/rss/rss5.xml', category: '国内' },
  { id: 'dis_chinadaily', name: 'China Daily', desc: '中国日报英文版', url: 'https://www.chinadaily.com.cn/rss/rss_sitemap.xml', category: '国际' },
  { id: 'dis_smzdm', name: '什么值得买', desc: '消费决策与好物推荐', url: 'https://www.smzdm.com/feed', category: '消费' },
  { id: 'dis_digitalocean', name: 'DigitalOcean Blog', desc: '云计算与开发者教程', url: 'https://www.digitalocean.com/community/articles/feed', category: '技术' },
];

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// --- Storage helpers ---
function loadFeeds() {
  if (!fs.existsSync(FEEDS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf8')); } catch { return []; }
}

function saveFeeds(feeds) {
  fs.writeFileSync(FEEDS_FILE, JSON.stringify(feeds, null, 2));
}

function loadArticles() {
  if (!fs.existsSync(ARTICLES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ARTICLES_FILE, 'utf8')); } catch { return {}; }
}

function saveArticles(articles) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2));
}

// --- Parse feed URL safely (follow redirects) ---
function parseUrl(feedUrl) {
  return new Promise((resolve, reject) => {
    const protocol = feedUrl.startsWith('https') ? https : http;
    const req = protocol.get(feedUrl, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        parseUrl(res.headers.location).then(resolve).catch(reject);
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// --- Fetch single feed ---
async function fetchFeed(feedId, feedUrl) {
  try {
    const xml = await parseUrl(feedUrl);
    const parsed = await parser.parseString(xml);
    const feedData = {
      title: parsed.title || feedUrl,
      description: parsed.description || '',
      link: parsed.link || '',
      image: parsed.image?.url || parsed.icon || '',
      updatedAt: new Date().toISOString()
    };

    const articles = loadArticles();
    if (!articles[feedId]) articles[feedId] = [];

    const existingLinks = new Set(articles[feedId].map(a => a.link));

    const newItems = (parsed.items || []).map(item => ({
      id: Buffer.from((item.guid || item.link || item.title + Date.now()).substring(0, 200)).toString('base64').replace(/\//g, '_'),
      title: item.title || 'No title',
      link: item.link || '',
      description: item.contentSnippet || item.summary || item.content || '',
      content: item.content || item['content:encoded'] || '',
      author: item.creator || item.author || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      read: existingLinks.has(item.link) ? (articles[feedId].find(a => a.link === item.link)?.read || false) : false,
      saved: articles[feedId].find(a => (item.guid || item.link) === a.link)?.saved || false
    }));

    // Merge: keep existing, add new
    const merged = [...newItems];
    for (const existing of articles[feedId]) {
      if (!newItems.find(n => n.link === existing.link)) {
        merged.push(existing);
      }
    }

    // Sort by date desc, keep latest 500
    merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    articles[feedId] = merged.slice(0, 500);
    saveArticles(articles);

    return { success: true, feed: feedData, count: newItems.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- REST API ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get all feeds
app.get('/api/feeds', (req, res) => {
  const feeds = loadFeeds();
  const articles = loadArticles();
  const result = feeds.map(f => ({
    ...f,
    unreadCount: (articles[f.id] || []).filter(a => !a.read).length,
    totalCount: (articles[f.id] || []).length
  }));
  res.json(result);
});

// Get articles for a feed (or all)
app.get('/api/articles', (req, res) => {
  const { feedId, search, saved, unreadOnly } = req.query;
  const feeds = loadFeeds();
  const articles = loadArticles();

  let result = [];

  if (feedId && feedId !== 'all') {
    result = (articles[feedId] || []);
  } else {
    // All feeds combined
    for (const feed of feeds) {
      for (const article of (articles[feed.id] || [])) {
        result.push({ ...article, feedId: feed.id, feedTitle: feed.title, feedFavicon: feed.favicon || '' });
      }
    }
  }

  if (saved === 'true') result = result.filter(a => a.saved);
  if (unreadOnly === 'true') result = result.filter(a => !a.read);
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      a.author.toLowerCase().includes(q)
    );
  }

  result.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  res.json(result);
  
  // 后台静默刷新（如果有缓存则跳过）
  if (feeds.length > 0 && (!feedId || feedId === 'all')) {
    for (const feed of feeds) {
      getCachedOrFetch(feed.id, () => fetchFeed(feed.id, feed.url));
    }
  } else if (feedId && feedId !== 'all') {
    const feed = feeds.find(f => f.id === feedId);
    if (feed) getCachedOrFetch(feedId, () => fetchFeed(feedId, feed.url));
  }
});

// Discovery: list popular feeds
app.get('/api/discovery', (req, res) => {
  const feeds = loadFeeds();
  const subscribedIds = new Set(feeds.map(f => f.url));
  const result = DISCOVERY_FEEDS.map(f => ({
    ...f,
    subscribed: subscribedIds.has(f.url)
  }));
  res.json(result);
});

// Subscribe from discovery (POST /api/discovery with {url})
app.post('/api/discovery/subscribe', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  try {
    const id = Buffer.from(url).toString('base64').replace(/\//g, '_').substring(0, 32);
    const feeds = loadFeeds();
    if (feeds.find(f => f.id === id)) {
      return res.json({ success: true, message: 'Already subscribed', already: true });
    }
    const result = await fetchFeed(id, url);
    if (!result.success) return res.status(400).json({ error: result.error });
    const newFeed = {
      id,
      url,
      title: result.feed.title,
      description: result.feed.description,
      link: result.feed.link,
      image: result.feed.image,
      favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).origin}&sz=32`,
      addedAt: new Date().toISOString()
    };
    feeds.push(newFeed);
    saveFeeds(feeds);
    res.json({ success: true, feed: { ...newFeed, unreadCount: 0, totalCount: 0 } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a feed
app.post('/api/feeds', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const id = Buffer.from(url).toString('base64').replace(/\//g, '_').substring(0, 32);
    const feeds = loadFeeds();
    if (feeds.find(f => f.id === id)) {
      return res.status(409).json({ error: 'Feed already exists' });
    }

    const result = await fetchFeed(id, url);
    if (!result.success) return res.status(400).json({ error: result.error });

    const newFeed = {
      id,
      url,
      title: result.feed.title,
      description: result.feed.description,
      link: result.feed.link,
      image: result.feed.image,
      favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).origin}&sz=32`,
      addedAt: new Date().toISOString()
    };

    feeds.push(newFeed);
    saveFeeds(feeds);

    res.json({ feed: { ...newFeed, unreadCount: 0, totalCount: 0 }, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a feed
app.delete('/api/feeds/:id', (req, res) => {
  const { id } = req.params;
  let feeds = loadFeeds();
  feeds = feeds.filter(f => f.id !== id);
  saveFeeds(feeds);

  const articles = loadArticles();
  delete articles[id];
  saveArticles(articles);

  res.json({ success: true });
});

// Refresh a feed (or all)
app.post('/api/feeds/:id/refresh', async (req, res) => {
  const { id } = req.params;
  const feeds = loadFeeds();
  const feed = feeds.find(f => f.id === id);

  if (!feed) return res.status(404).json({ error: 'Feed not found' });

  const result = await fetchFeed(id, feed.url);
  res.json(result);
});

// Refresh all feeds
app.post('/api/feeds/refresh-all', async (req, res) => {
  const feeds = loadFeeds();
  const results = [];
  for (const feed of feeds) {
    const r = await fetchFeed(feed.id, feed.url);
    results.push({ feedId: feed.id, ...r });
  }
  res.json(results);
});

// Mark article read/unread
app.patch('/api/articles/:id', (req, res) => {
  const { id } = req.params;
  const { read, saved } = req.body;
  const articles = loadArticles();

  let updated = false;
  for (const feedId of Object.keys(articles)) {
    const article = articles[feedId].find(a => a.id === id);
    if (article) {
      if (read !== undefined) { article.read = read; updated = true; }
      if (saved !== undefined) { article.saved = saved; updated = true; }
      break;
    }
  }

  if (updated) saveArticles(articles);
  res.json({ success: updated });
});

// Mark all read for a feed
app.post('/api/feeds/:id/mark-all-read', (req, res) => {
  const { id } = req.params;
  const articles = loadArticles();
  if (articles[id]) {
    articles[id].forEach(a => a.read = true);
    saveArticles(articles);
  }
  res.json({ success: true });
});

// --- Cron: refresh every 30 minutes ---
cron.schedule('*/30 * * * *', async () => {
  console.log('[Cron] Refreshing all feeds...');
  const feeds = loadFeeds();
  for (const feed of feeds) {
    await getCachedOrFetch(feed.id, () => fetchFeed(feed.id, feed.url));
  }
  console.log('[Cron] Done refreshing all feeds.');
});

// Initial startup: 静默后台刷新，不阻塞启动
setTimeout(async () => {
  const feeds = loadFeeds();
  if (feeds.length > 0) {
    console.log('Initial feed refresh (background)...');
    for (const feed of feeds) {
      getCachedOrFetch(feed.id, () => fetchFeed(feed.id, feed.url));
    }
  }
}, 3000);

// 支持环境变量配置端口（Hostinger 需要动态端口）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RSS Reader running at http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
