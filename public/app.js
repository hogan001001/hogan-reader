const API = '';
let currentFeed = 'all';
let feeds = [];
let articles = [];
let selectedArticleId = null;
let searchTimeout = null;

// --- DOM refs ---
const $ = id => document.getElementById(id);
const feedsContainer = $('feeds-container');
const articleList = $('article-list');
const readerContent = $('reader-content');
const readerEmpty = $('reader-empty');
const currentFeedTitle = $('current-feed-title');
const searchInput = $('search-input');
const countAll = $('count-all');
const countSaved = $('count-saved');
const lastUpdated = $('last-updated');
const loadingIndicator = $('loading-indicator');
const emptyState = $('empty-state');
const modal = $('modal-add-feed');
const feedUrlInput = $('feed-url-input');
const modalError = $('modal-error');
const btnRefreshAll = $('btn-refresh-all');

// --- Init ---
async function init() {
  await loadFeeds();
  await loadArticles();
  updateLastUpdated();
  setInterval(updateLastUpdated, 60000);
}

// --- Load feeds ---
async function loadFeeds() {
  try {
    const res = await fetch(`${API}/api/feeds`);
    feeds = await res.json();
    renderFeeds();
  } catch (e) {
    console.error('Failed to load feeds:', e);
  }
}

// --- Load articles ---
async function loadArticles(query = {}) {
  showLoading(true);
  try {
    const params = new URLSearchParams();
    if (currentFeed === 'saved') {
      params.set('saved', 'true');
    } else if (currentFeed !== 'all') {
      params.set('feedId', currentFeed);
    }
    if (query.search) params.set('search', query.search);

    const res = await fetch(`${API}/api/articles?${params}`);
    articles = await res.json();
    renderArticles();
  } catch (e) {
    console.error('Failed to load articles:', e);
  } finally {
    showLoading(false);
  }
}

// --- Render feeds list ---
function renderFeeds() {
  feedsContainer.innerHTML = '';
  let totalUnread = 0;

  feeds.forEach(feed => {
    totalUnread += feed.unreadCount || 0;

    const div = document.createElement('div');
    div.className = 'feed-item';
    div.dataset.feed = feed.id;
    div.dataset.title = feed.title;

    div.innerHTML = `
      <span class="feed-icon">${feed.image ? `<img src="${feed.image}" width="16" height="16" style="border-radius:2px;object-fit:contain;">` : '📡'}</span>
      <span class="feed-name">${escapeHtml(feed.title)}</span>
      <span class="feed-count">${feed.unreadCount || 0}</span>
      <span class="feed-delete" title="删除">✕</span>
    `;

    div.addEventListener('click', e => {
      if (e.target.classList.contains('feed-delete')) {
        deleteFeed(feed.id);
      } else {
        selectFeed(feed.id, feed.title);
      }
    });

    feedsContainer.appendChild(div);
  });

  countAll.textContent = totalUnread;
  const savedCount = articles.filter(a => a.saved).length;
  countSaved.textContent = savedCount;

  // Update active feed
  document.querySelectorAll('.feed-item').forEach(el => {
    el.classList.toggle('active', el.dataset.feed === currentFeed);
  });
}

// --- Render articles ---
function renderArticles() {
  articleList.innerHTML = '';

  if (articles.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  articles.forEach(article => {
    const div = document.createElement('div');
    const isUnread = !article.read;
    div.className = `article-item${isUnread ? ' unread' : ''}${article.id === selectedArticleId ? ' selected' : ''}`;
    div.dataset.id = article.id;

    const feedName = article.feedTitle || feeds.find(f => f.id === article.feedId)?.title || '';

    div.innerHTML = `
      ${isUnread ? '<div class="article-dot"></div>' : ''}
      <div class="article-title">${article.saved ? '⭐ ' : ''}${escapeHtml(article.title)}</div>
      <div class="article-meta">
        <span class="article-feed-name">${escapeHtml(feedName)}</span>
        <span>·</span>
        <span>${formatDate(article.pubDate)}</span>
        ${article.saved ? '<span class="article-saved">★ 已收藏</span>' : ''}
      </div>
    `;

    div.addEventListener('click', () => selectArticle(article));
    articleList.appendChild(div);
  });

  countSaved.textContent = articles.filter(a => a.saved).length;
}

// --- Select article ---
async function selectArticle(article) {
  selectedArticleId = article.id;

  // Mark as read
  if (!article.read) {
    article.read = true;
    await fetch(`${API}/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true })
    });
    await loadFeeds();
  }

  // Render articles (update read state)
  renderArticles();

  // Show reader
  readerEmpty.style.display = 'none';
  readerContent.style.display = 'flex';

  const feed = feeds.find(f => f.id === article.feedId);
  $('reader-feed-name').textContent = feed?.title || '';
  $('reader-date').textContent = formatDate(article.pubDate);
  $('reader-title').textContent = article.title;

  // Content
  const content = article.content || article.description || '';
  $('reader-body').innerHTML = makeReadable(content);

  // Toggle save button
  const btnSave = $('btn-toggle-save');
  btnSave.textContent = article.saved ? '★ 已收藏' : '☆ 收藏';

  $('btn-open-original').onclick = () => {
    if (article.link) window.open(article.link, '_blank');
  };

  $('btn-toggle-read').onclick = async () => {
    article.read = !article.read;
    await fetch(`${API}/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: article.read })
    });
    $('btn-toggle-read').textContent = article.read ? '↩ 未读' : '✓ 已读';
    renderArticles();
    await loadFeeds();
  };

  $('btn-toggle-save').onclick = async () => {
    article.saved = !article.saved;
    await fetch(`${API}/api/articles/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: article.saved })
    });
    $('btn-toggle-save').textContent = article.saved ? '★ 已收藏' : '☆ 收藏';
    if (currentFeed === 'saved' && !article.saved) {
      await loadArticles();
      await loadFeeds();
    } else {
      renderArticles();
      await loadFeeds();
    }
  };

  $('btn-toggle-read').textContent = '↩ 未读';
}

// --- Select feed ---
function selectFeed(feedId, title) {
  currentFeed = feedId;
  currentFeedTitle.textContent = title || '全部';
  selectedArticleId = null;
  readerContent.style.display = 'none';
  readerEmpty.style.display = 'flex';

  document.querySelectorAll('.feed-item').forEach(el => {
    el.classList.toggle('active', el.dataset.feed === feedId);
  });

  loadArticles();
}

// --- Add feed ---
async function addFeed(url) {
  modalError.textContent = '添加中...';
  modalError.style.color = 'var(--text-secondary)';
  try {
    const res = await fetch(`${API}/api/feeds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '添加失败');
    await loadFeeds();
    await loadArticles();
    closeModal();
  } catch (e) {
    modalError.textContent = e.message;
    modalError.style.color = '#e53e3e';
  }
}

// --- Delete feed ---
async function deleteFeed(feedId) {
  if (!confirm('确定删除这个订阅源？')) return;
  await fetch(`${API}/api/feeds/${feedId}`, { method: 'DELETE' });
  if (currentFeed === feedId) selectFeed('all', '全部');
  await loadFeeds();
  await loadArticles();
}

// --- Refresh all ---
async function refreshAll() {
  btnRefreshAll.textContent = '⟳';
  btnRefreshAll.style.animation = 'spin 1s linear infinite';
  await fetch(`${API}/api/feeds/refresh-all`, { method: 'POST' });
  btnRefreshAll.style.animation = '';
  btnRefreshAll.textContent = '⟳';
  await loadFeeds();
  await loadArticles();
  updateLastUpdated();
}

// --- Mark all read ---
async function markAllRead() {
  const targetFeed = currentFeed === 'all' ? null : currentFeed;
  if (!targetFeed) {
    // Mark all articles across all feeds read
    const allArticles = await fetch(`${API}/api/articles`).then(r => r.json());
    for (const a of allArticles) {
      if (!a.read) {
        await fetch(`${API}/api/articles/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true })
        });
      }
    }
  } else {
    await fetch(`${API}/api/feeds/${targetFeed}/mark-all-read`, { method: 'POST' });
  }
  await loadFeeds();
  await loadArticles();
}

// --- Modal ---
function openModal() {
  modal.style.display = 'flex';
  feedUrlInput.value = '';
  feedUrlInput.focus();
  modalError.textContent = '';
}

function closeModal() {
  modal.style.display = 'none';
}

$('btn-add-feed').onclick = openModal;
$('btn-modal-cancel').onclick = closeModal;
$('btn-modal-add').onclick = () => {
  const url = feedUrlInput.value.trim();
  if (url) addFeed(url);
};

modal.querySelector('.modal-backdrop').onclick = closeModal;

feedUrlInput.onkeydown = e => {
  if (e.key === 'Enter') addFeed(feedUrlInput.value.trim());
  if (e.key === 'Escape') closeModal();
};

$('btn-refresh-all').onclick = refreshAll;
$('btn-mark-all-read').onclick = markAllRead;

// Feed item nav
$('feeds-container').addEventListener('click', e => {
  const item = e.target.closest('.feed-item');
  if (item && !e.target.classList.contains('feed-delete')) {
    selectFeed(item.dataset.feed, item.dataset.title);
  }
});

// Global feed items
document.querySelector('[data-feed="all"]').onclick = () => selectFeed('all', '全部');
document.querySelector('[data-feed="saved"]').onclick = () => selectFeed('saved', '已收藏');

// Search
searchInput.oninput = () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadArticles({ search: searchInput.value.trim() });
  }, 300);
};

// --- Helpers ---
function showLoading(show) {
  loadingIndicator.style.display = show ? 'flex' : 'none';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function makeReadable(html) {
  if (!html) return '<p style="color:var(--text-secondary)">无正文内容</p>';
  // If it's just text (no HTML tags), wrap it
  if (!/<[a-z]/i.test(html)) {
    return html.split('\n').filter(l => l.trim()).map(l => `<p>${escapeHtml(l)}</p>`).join('');
  }
  return html;
}

function updateLastUpdated() {
  lastUpdated.textContent = `更新: ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

// --- Discovery Panel ---
let discoveryFeeds = [];
let discoveryActiveCat = '全部';
let discoverySearchQuery = '';

async function openDiscovery() {
  const panel = document.getElementById('discovery-panel');
  const overlay = document.getElementById('discovery-overlay');
  panel.classList.add('open');
  overlay.style.display = 'block';

  if (discoveryFeeds.length === 0) {
    document.getElementById('discovery-loading').style.display = 'flex';
    try {
      const res = await fetch(`${API}/api/discovery`);
      discoveryFeeds = await res.json();
    } catch (e) {
      discoveryFeeds = [];
    }
    document.getElementById('discovery-loading').style.display = 'none';
  }

  renderDiscoveryCategories();
  renderDiscoveryList();
}

function closeDiscovery() {
  document.getElementById('discovery-panel').classList.remove('open');
  document.getElementById('discovery-overlay').style.display = 'none';
}

function renderDiscoveryCategories() {
  const cats = ['全部', ...new Set(discoveryFeeds.map(f => f.category).filter(Boolean))];
  const container = document.getElementById('discovery-categories');
  container.innerHTML = cats.map(cat =>
    `<button class="cat-tag${cat === discoveryActiveCat ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
  ).join('');
  container.querySelectorAll('.cat-tag').forEach(btn => {
    btn.onclick = () => {
      discoveryActiveCat = btn.dataset.cat;
      renderDiscoveryCategories();
      renderDiscoveryList();
    };
  });
}

function renderDiscoveryList() {
  const container = document.getElementById('discovery-list');
  const q = discoverySearchQuery.toLowerCase();
  const filtered = discoveryFeeds.filter(f => {
    const matchCat = discoveryActiveCat === '全部' || f.category === discoveryActiveCat;
    const matchQ = !q || f.name.toLowerCase().includes(q) || (f.desc || '').toLowerCase().includes(q) || (f.category || '').toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>没有找到相关订阅源</p></div>';
    return;
  }

  container.innerHTML = filtered.map(f => `
    <div class="discovery-item" data-url="${f.url}">
      <div class="dis-icon">${f.name.charAt(0)}</div>
      <div class="dis-info">
        <div class="dis-name">${escapeHtml(f.name)}</div>
        <div class="dis-desc">${escapeHtml(f.desc || '')}</div>
      </div>
      <span class="dis-cat">${escapeHtml(f.category || '')}</span>
      <button class="dis-subscribe-btn${f.subscribed ? ' subscribed' : ''}" data-url="${f.url}">
        ${f.subscribed ? '已订阅' : '订阅'}
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.dis-subscribe-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const url = btn.dataset.url;
      if (btn.classList.contains('subscribed')) return;
      btn.classList.add('loading');
      btn.textContent = '订阅中...';
      try {
        const res = await fetch(`${API}/api/discovery/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (res.ok) {
          btn.classList.remove('loading');
          btn.classList.add('done');
          btn.textContent = '✓ 已订阅';
          btn.classList.add('subscribed');
          // Update feeds list
          await loadFeeds();
          // Mark as subscribed in discoveryFeeds
          const feed = discoveryFeeds.find(f => f.url === url);
          if (feed) feed.subscribed = true;
        } else {
          throw new Error(data.error || '订阅失败');
        }
      } catch (err) {
        btn.classList.remove('loading');
        btn.textContent = '订阅失败';
        setTimeout(() => { btn.textContent = '订阅'; }, 2000);
      }
    };
  });
}

document.getElementById('btn-open-discovery').onclick = openDiscovery;
document.getElementById('btn-close-discovery').onclick = closeDiscovery;
document.getElementById('discovery-overlay').onclick = closeDiscovery;

document.getElementById('discovery-search').oninput = () => {
  discoverySearchQuery = document.getElementById('discovery-search').value.trim();
  renderDiscoveryList();
};

// Start
init();
