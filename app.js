/* Telegram Drive frontend (v5) — framework-free, no build step.
 *
 * ARCHITECTURE (unchanged, but hardened):
 *   CONTROL PLANE  Cloudflare Worker  — /auth, /files, /folders (KV metadata only).
 *   DATA PLANE     Render backend     — /upload (chunk POST) and /file/:id (byte serving).
 *   The Worker never touches raw bytes, so large transfers bypass Cloudflare's
 *   CPU / RAM / 30s limits entirely.
 *
 * WHAT'S NEW IN v5
 *   • Reactive store with subscriber-based rendering (no more "call render() everywhere").
 *   • View state persisted: scope, parentId, sort, view, query.
 *   • Sorting (name / modified / size, asc+desc) applied client-side, instantly.
 *   • Multi-select (Ctrl/Cmd+click, Shift+click range) with a bulk action bar:
 *     download, star, move, trash, restore, delete-forever.
 *   • Keyboard-first: arrows to move a focused card, Enter to open, Space to
 *     select, Ctrl+A select-all, Delete to trash, / to search, Esc to clear.
 *   • Upload queue is now a real queue: per-file pause / resume / cancel,
 *     live aggregate progress, byte counter and ETA.
 *   • Rich preview: image zoom + rotate, media gallery with ←/→ navigation,
 *     JSON pretty-print, CSV table view, markdown-ish rendering fallback.
 *   • Drag-to-move: drop files onto a folder card to move them.
 *   • Copy-shareable per-file link + copy file name from the action menu.
 *   • Storage meter is logarithmic AND shows file/folder split.
 *   • Network-aware: offline banner, auto-refresh on reconnect, retry jitter.
 *   • All new UI is injected from JS, so index.html stays untouched.
 */
(() => {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // Configuration
  // ───────────────────────────────────────────────────────────────────────
  const API_URL = 'https://drive-worker.phamdatt140613.workers.dev';
  const RENDER_URL = 'https://teledrive-backend-jwy5.onrender.com';

  const CHUNK_SIZE = 50 * 1024 * 1024;
  const UPLOAD_CONCURRENCY = 2;
  const INTER_CHUNK_DELAY_MS = 1_200;
  const MAX_RETRY = 5;
  const RETRY_BASE_MS = 2_000;
  const RETRY_JITTER_MS = 400;

  const LIST_CACHE_TTL_MS = 150_000;
  const LIST_CACHE_PREFIX = 'telegramDrive.listCache.';
  const PREF_PREFIX = 'telegramDrive.pref.';

  const TEXT_PREVIEW_LINE_LIMIT = 5_000;
  const TEXT_PREVIEW_BYTE_LIMIT = 2 * 1024 * 1024;
  const SELECTION_LONG_PRESS_MS = 480;

  const KEYS = {
    lang: 'telegramDrive.lang',
    theme: 'telegramDrive.theme',
    view: 'telegramDrive.view',
    token: 'telegramDrive.session'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const LANGUAGE_LABEL = {
    js: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', py: 'Python', cpp: 'C++',
    c: 'C', cs: 'C#', java: 'Java', go: 'Go', rs: 'Rust', rb: 'Ruby',
    php: 'PHP', sh: 'Shell', sql: 'SQL', html: 'HTML', css: 'CSS',
    scss: 'SCSS', json: 'JSON', xml: 'XML', yml: 'YAML', yaml: 'YAML',
    md: 'Markdown', csv: 'CSV', log: 'Log', txt: 'Text'
  };

  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'];
  const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', 'mov', 'avi'];
  const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
  const TEXT_EXTENSIONS = ['txt', 'json', 'js', 'jsx', 'ts', 'py', 'cpp', 'c', 'cs', 'java', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'html', 'css', 'scss', 'xml', 'yml', 'yaml', 'md', 'log', 'csv', 'ini', 'env'];

  // ───────────────────────────────────────────────────────────────────────
  // Translations
  // ───────────────────────────────────────────────────────────────────────
  const COPY = {
    vi: {
      upload: 'Tải tệp lên', myFiles: 'Tệp của tôi', recent: 'Gần đây', starred: 'Đã gắn sao', trash: 'Thùng rác', storage: 'Dung lượng', storageCaption: 'Tệp đang được lưu trên Telegram',
      settings: 'Cài đặt kết nối', toggleTheme: 'Đổi giao diện', searchPlaceholder: 'Tìm kiếm trong Drive', newFolder: 'Thư mục mới', viewMode: 'Chế độ xem', dropTitle: 'Thả tệp để tải lên',
      dropDescription: 'Tệp sẽ được chia nhỏ và lưu riêng tư trên Telegram.', name: 'Tên', modified: 'Đã sửa đổi', size: 'Kích thước', emptyTitle: 'Thư mục này đang trống', emptyDescription: 'Kéo tệp vào đây hoặc chọn tải tệp lên để bắt đầu.',
      uploads: 'Đang tải lên', welcome: 'Chào mừng trở lại', loginIntro: 'Nhập mật khẩu để mở không gian tệp riêng tư của bạn.', password: 'Mật khẩu truy cập', passwordPlaceholder: 'Nhập mật khẩu', signIn: 'Đăng nhập', loginNote: 'Mật khẩu không được lưu trong trình duyệt.',
      cancel: 'Hủy', save: 'Lưu thay đổi', root: 'Tệp của tôi', folder: 'Thư mục', file: 'Tệp', download: 'Tải xuống', preview: 'Xem trước', rename: 'Đổi tên', removeStar: 'Bỏ gắn sao', addStar: 'Gắn sao', moveToTrash: 'Chuyển vào thùng rác', restore: 'Khôi phục', deleteForever: 'Xóa vĩnh viễn',
      newFolderTitle: 'Thư mục mới', newFolderLabel: 'Tên thư mục', newFolderHelp: 'Thư mục sẽ được tạo tại vị trí hiện tại.', renameTitle: 'Đổi tên', renameLabel: 'Tên mới', saveName: 'Lưu tên', uploading: 'Đang tải lên', preparing: 'Đang chuẩn bị', uploadingPart: 'Đang tải phần {current}/{total}', waitingRetry: 'Lỗi mạng, thử lại sau {seconds}s ({attempt}/{max})', waitingFlood: 'Telegram giới hạn tốc độ, đợi {seconds}s...', completed: 'Hoàn tất', uploadSuccess: 'Đã tải “{name}” lên thành công.',
      folderCreated: 'Đã tạo thư mục “{name}”.', renamed: 'Đã đổi tên.', movedToTrash: 'Đã chuyển vào thùng rác.', restored: 'Đã khôi phục.', deleted: 'Đã xóa vĩnh viễn.', downloaded: 'Đang chuẩn bị tệp tải xuống…', loadingPreview: 'Đang tải xem trước…', previewFailed: 'Không thể xem trước tệp này.', previewTooBig: 'Không thể phát tệp này (dữ liệu trả về trống hoặc lỗi định dạng).', wrongPassword: 'Mật khẩu không đúng hoặc phiên đã hết hạn.', networkError: 'Không thể kết nối đến máy chủ. Hãy kiểm tra mạng của bạn.', confirmDelete: 'Xóa vĩnh viễn “{name}”? Hành động này không thể hoàn tác.', confirmSignOut: 'Bạn có muốn đăng xuất khỏi Telegram Drive?', noSearch: 'Không tìm thấy tệp phù hợp', noSearchDesc: 'Hãy thử từ khóa khác hoặc quay lại thư mục của bạn.', loadError: 'Không thể tải danh sách tệp.', uploadingToRoot: 'Bạn đang ở mục đặc biệt; tệp sẽ được tải lên thư mục gốc.', signOut: 'Đăng xuất', requestFailed: 'Thao tác không thành công.', copy: 'Sao chép', copied: 'Đã chép!', truncatedNotice: 'Tệp lớn — đã tắt đánh số dòng để tối ưu hiệu năng.',
      sort: 'Sắp xếp', sortName: 'Tên', sortModified: 'Ngày sửa', sortSize: 'Kích thước', sortAsc: 'Tăng dần', sortDesc: 'Giảm dần', selected: 'đã chọn', clearSelection: 'Bỏ chọn', move: 'Di chuyển', moveTitle: 'Di chuyển đến…', moveHelp: 'Chọn thư mục đích cho các mục đã chọn.', moveRoot: 'Thư mục gốc', moveSuccess: 'Đã di chuyển {count} mục.', bulkTrash: 'Chuyển vào thùng rác', bulkDownload: 'Tải xuống', bulkStar: 'Gắn sao', bulkUnstar: 'Bỏ gắn sao', bulkDelete: 'Xóa vĩnh viễn', bulkRestore: 'Khôi phục', copyLink: 'Sao chép liên kết', copyName: 'Sao chép tên', linkCopied: 'Đã sao chép liên kết.', nameCopied: 'Đã sao chép tên.', offline: 'Bạn đang ngoại tuyến. Một số thao tác có thể không hoạt động.', backOnline: 'Đã kết nối lại.', pauseUpload: 'Tạm dừng', resumeUpload: 'Tiếp tục', cancelUpload: 'Hủy tải lên', uploadPaused: 'Đã tạm dừng', uploadCancelled: 'Đã hủy tải lên', eta: 'còn {time}', gallery: 'Thư viện', of: 'trên', zoomIn: 'Phóng to', zoomOut: 'Thu nhỏ', rotate: 'Xoay', reset: 'Đặt lại', wrapLines: 'Ngắt dòng', totalItems: '{count} mục', folders: 'thư mục', files: 'tệp', sortApplied: 'Đã sắp xếp theo {field}', refresh: 'Làm mới', refreshing: 'Đang làm mới…', multiSelectHint: 'Giữ Ctrl để chọn nhiều'
    },
    en: {
      upload: 'Upload files', myFiles: 'My files', recent: 'Recent', starred: 'Starred', trash: 'Trash', storage: 'Storage', storageCaption: 'Files are privately stored on Telegram', settings: 'Connection settings', toggleTheme: 'Toggle theme', searchPlaceholder: 'Search in Drive', newFolder: 'New folder', viewMode: 'View mode', dropTitle: 'Drop files to upload', dropDescription: 'Files are chunked and privately stored on Telegram.', name: 'Name', modified: 'Last modified', size: 'Size', emptyTitle: 'This folder is empty', emptyDescription: 'Drop files here or choose Upload files to get started.', uploads: 'Uploads', welcome: 'Welcome back', loginIntro: 'Enter your password to access your private file space.', password: 'Access password', passwordPlaceholder: 'Enter password', signIn: 'Sign in', loginNote: 'Your password is never stored in this browser.',
      cancel: 'Cancel', save: 'Save changes', root: 'My files', folder: 'Folder', file: 'File', download: 'Download', preview: 'Preview', rename: 'Rename', removeStar: 'Remove star', addStar: 'Add star', moveToTrash: 'Move to trash', restore: 'Restore', deleteForever: 'Delete forever', newFolderTitle: 'New folder', newFolderLabel: 'Folder name', newFolderHelp: 'The folder will be created in the current location.', renameTitle: 'Rename', renameLabel: 'New name', saveName: 'Save name', uploading: 'Uploading', preparing: 'Preparing', uploadingPart: 'Uploading part {current}/{total}', waitingRetry: 'Network error, retrying in {seconds}s ({attempt}/{max})', waitingFlood: 'Telegram rate limit hit, waiting {seconds}s...', completed: 'Completed', uploadSuccess: '“{name}” uploaded successfully.', folderCreated: 'Folder “{name}” created.', renamed: 'Name updated.', movedToTrash: 'Moved to trash.', restored: 'Restored.', deleted: 'Permanently deleted.', downloaded: 'Preparing your download…', loadingPreview: 'Loading preview…', previewFailed: 'This file could not be previewed.', previewTooBig: 'This file could not be played (empty or malformed response).', wrongPassword: 'Incorrect password or expired session.', networkError: 'Could not reach the server. Check your connection.', confirmDelete: 'Permanently delete “{name}”? This cannot be undone.', confirmSignOut: 'Sign out of Telegram Drive?', noSearch: 'No matching files', noSearchDesc: 'Try another keyword or return to your files.', loadError: 'Unable to load files.', uploadingToRoot: 'You are in a special view; files will upload to the root folder.', signOut: 'Sign out', requestFailed: 'The action could not be completed.', copy: 'Copy', copied: 'Copied!', truncatedNotice: 'Large file — line numbers disabled for performance.',
      sort: 'Sort', sortName: 'Name', sortModified: 'Modified', sortSize: 'Size', sortAsc: 'Ascending', sortDesc: 'Descending', selected: 'selected', clearSelection: 'Clear', move: 'Move', moveTitle: 'Move to…', moveHelp: 'Pick a destination folder for the selected items.', moveRoot: 'Root folder', moveSuccess: 'Moved {count} item(s).', bulkTrash: 'Move to trash', bulkDownload: 'Download', bulkStar: 'Star', bulkUnstar: 'Unstar', bulkDelete: 'Delete forever', bulkRestore: 'Restore', copyLink: 'Copy link', copyName: 'Copy name', linkCopied: 'Link copied.', nameCopied: 'Name copied.', offline: 'You are offline. Some actions may not work.', backOnline: 'Back online.', pauseUpload: 'Pause', resumeUpload: 'Resume', cancelUpload: 'Cancel upload', uploadPaused: 'Paused', uploadCancelled: 'Upload cancelled', eta: '{time} left', gallery: 'Gallery', of: 'of', zoomIn: 'Zoom in', zoomOut: 'Zoom out', rotate: 'Rotate', reset: 'Reset', wrapLines: 'Wrap lines', totalItems: '{count} items', folders: 'folders', files: 'files', sortApplied: 'Sorted by {field}', refresh: 'Refresh', refreshing: 'Refreshing…', multiSelectHint: 'Hold Ctrl to select multiple'
    }
  };

  // ───────────────────────────────────────────────────────────────────────
  // Reactive store
  // ───────────────────────────────────────────────────────────────────────
  const store = {
    token: sessionStorage.getItem(KEYS.token) || '',
    lang: localStorage.getItem(KEYS.lang) || (navigator.language.startsWith('vi') ? 'vi' : 'en'),
    theme: localStorage.getItem(KEYS.theme) || 'light',
    view: localStorage.getItem(KEYS.view) || 'grid',
    scope: readPref('scope', 'files'),
    parentId: readPref('parentId', null),
    sortField: readPref('sortField', 'name'),
    sortDir: readPref('sortDir', 'asc'),
    query: '',
    items: [],
    breadcrumbs: [],
    stats: { bytes: 0, count: 0 },
    selection: new Set(),
    lastIndex: -1,
    isLoading: false,
    isOffline: !navigator.onLine,
    uploadingCount: 0,
    promptHandler: null,
    pendingMove: null
  };

  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(fn => { try { fn(store); } catch { /* isolate subscriber errors */ } }); }

  function readPref(key, fallback) {
    try { const raw = localStorage.getItem(PREF_PREFIX + key); return raw === null ? fallback : JSON.parse(raw); }
    catch { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(PREF_PREFIX + key, JSON.stringify(value)); } catch { /* storage may be full */ }
  }

  function t(key, values = {}) {
    const table = COPY[store.lang] || COPY.en;
    return (table[key] || COPY.en[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  }

  // ───────────────────────────────────────────────────────────────────────
  // DOM helpers
  // ───────────────────────────────────────────────────────────────────────
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function formatBytes(bytes = 0) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    const value = n / 1024 ** index;
    return `${value.toFixed(index ? (value >= 10 ? 0 : 1) : 0)} ${units[index]}`;
  }
  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat(store.lang === 'vi' ? 'vi-VN' : 'en-US',
        { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
    } catch { return '—'; }
  }
  function formatRelative(date) {
    const diff = Date.now() - new Date(date).getTime();
    if (!Number.isFinite(diff)) return '—';
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return store.lang === 'vi' ? 'vừa xong' : 'just now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d`;
    return formatDate(date);
  }
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '—';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return `${m}m ${r}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fileExtension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(name || '');
    return match ? match[1].toLowerCase() : '';
  }
  function debounce(fn, wait) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => (
      { '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[ch]
    ));
  }

  // ───────────────────────────────────────────────────────────────────────
  // List cache (sessionStorage)
  // ───────────────────────────────────────────────────────────────────────
  function listCacheKey() {
    return `${LIST_CACHE_PREFIX}${store.scope}|${store.parentId || ''}|${store.query}`;
  }
  function readListCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached.savedAt > LIST_CACHE_TTL_MS) return null;
      return cached;
    } catch { return null; }
  }
  function writeListCache(key, data) {
    try { sessionStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() })); }
    catch { /* caching is best-effort */ }
  }
  function clearListCache() {
    try {
      Object.keys(sessionStorage)
        .filter(key => key.startsWith(LIST_CACHE_PREFIX))
        .forEach(key => sessionStorage.removeItem(key));
    } catch { /* noop */ }
  }

  // ───────────────────────────────────────────────────────────────────────
  // API layer
  // ───────────────────────────────────────────────────────────────────────
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (store.token && options.auth !== false) headers.set('X-Drive-Token', store.token);
    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : null;
    if (!response.ok || payload?.ok === false) {
      const message = payload?.error || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload ?? response;
  }

  async function loadFiles({ force = false, silent = false } = {}) {
    if (!store.token || store.isLoading) return;
    const cacheKey = listCacheKey();
    if (!force) {
      const cached = readListCache(cacheKey);
      if (cached) {
        store.items = cached.items;
        store.breadcrumbs = cached.breadcrumbs;
        store.stats = cached.stats;
        store.selection.clear();
        emit();
        return;
      }
    }
    store.isLoading = true;
    if (!silent) emit();

    const params = new URLSearchParams({ scope: store.scope });
    if (store.scope === 'files' && store.parentId) params.set('parentId', store.parentId);
    if (store.query) params.set('q', store.query);

    try {
      const data = await api(`/files?${params}`);
      store.items = Array.isArray(data.items) ? data.items : [];
      store.breadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];
      store.stats = data.stats || store.stats;
      store.selection.clear();
      writeListCache(cacheKey, {
        items: store.items,
        breadcrumbs: store.breadcrumbs,
        stats: store.stats
      });
    } catch (error) {
      if (error.status === 401) { handleExpiredSession(); return; }
      store.items = [];
      toast(t('loadError'), 'error');
    } finally {
      store.isLoading = false;
      emit();
    }
  }

  async function refreshFiles() {
    clearListCache();
    await loadFiles({ force: true });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Sorting
  // ───────────────────────────────────────────────────────────────────────
  function sortedItems() {
    const items = [...store.items];
    const dir = store.sortDir === 'desc' ? -1 : 1;
    const collator = new Intl.Collator(store.lang === 'vi' ? 'vi' : 'en', { numeric: true, sensitivity: 'base' });

    items.sort((a, b) => {
      // Folders always float above files in the "files" scope.
      if (store.scope === 'files' && a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      let result = 0;
      switch (store.sortField) {
        case 'modified':
          result = new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0);
          break;
        case 'size':
          result = (Number(a.size) || 0) - (Number(b.size) || 0);
          break;
        default:
          result = collator.compare(a.name || '', b.name || '');
      }
      if (result === 0) result = collator.compare(a.name || '', b.name || '');
      return result * dir;
    });
    return items;
  }

  function setSort(field) {
    if (store.sortField === field) {
      store.sortDir = store.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      store.sortField = field;
      store.sortDir = 'asc';
    }
    writePref('sortField', store.sortField);
    writePref('sortDir', store.sortDir);
    emit();
  }

  // ───────────────────────────────────────────────────────────────────────
  // Rendering
  // ───────────────────────────────────────────────────────────────────────
  function render() {
    applyTranslations();
    renderNavigation();
    renderBreadcrumbs();
    renderToolbar();
    renderFiles();
    renderStorage();
    renderSelectionBar();
  }

  function applyTranslations() {
    document.documentElement.lang = store.lang;
    document.title = 'Telegram Drive';
    $$('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    $$('[data-i18n-title]').forEach(node => { node.title = t(node.dataset.i18nTitle); });

    const languageButton = $('#languageButton');
    if (languageButton) languageButton.textContent = store.lang === 'vi' ? 'EN' : 'VI';
    const themeButton = $('#themeButton');
    if (themeButton) themeButton.replaceChildren(icon(store.theme === 'dark' ? 'sun' : 'moon'));
    document.body.classList.toggle('dark', store.theme === 'dark');
    document.body.classList.toggle('is-offline', store.isOffline);
  }

  function renderNavigation() {
    $$('.nav-item').forEach(button => button.classList.toggle('is-active', button.dataset.scope === store.scope));
    const scopeKey = store.scope === 'files' ? 'myFiles' : store.scope;
    const title = store.query ? `${t('myFiles')} · ${store.query}` : t(scopeKey);
    const titleEl = $('#pageTitle');
    if (titleEl) titleEl.textContent = title;
    const labelEl = $('#scopeLabel');
    if (labelEl) labelEl.textContent = store.query
      ? t('searchPlaceholder').toUpperCase()
      : store.scope === 'files' ? 'TELEGRAM DRIVE' : t(scopeKey).toUpperCase();
    const newFolder = $('#newFolderButton');
    if (newFolder) newFolder.hidden = store.scope !== 'files';
    const mobileUpload = $('#uploadButtonMobile');
    if (mobileUpload) mobileUpload.hidden = store.scope === 'trash';
  }

  function renderStorage() {
    const sizeEl = $('#storageSize');
    if (sizeEl) sizeEl.textContent = formatBytes(store.stats.bytes);
    const captionEl = $('#storageCaption');
    if (captionEl) {
      const count = store.stats.count || 0;
      const folders = store.items.filter(item => item.type === 'folder').length;
      captionEl.textContent = count
        ? `${count} ${t('files')} · ${folders} ${t('folders')}`
        : t('storageCaption');
    }
    const bar = $('#storageBar');
    if (bar) bar.style.width = `${clamp(Math.log10(Number(store.stats.bytes || 1) + 10) * 10, 7, 100)}%`;
  }

  function renderBreadcrumbs() {
    const container = $('#breadcrumbs');
    if (!container) return;
    const fragment = document.createDocumentFragment();
    if (store.scope !== 'files') {
      fragment.append(el('span', 'crumb', t(store.scope)));
      container.replaceChildren(fragment);
      return;
    }
    const crumbs = [{ id: null, name: t('root') }, ...store.breadcrumbs];
    crumbs.forEach((crumb, index) => {
      if (index) {
        const separator = icon('chevron');
        separator.classList.add('crumb-separator');
        fragment.append(separator);
      }
      const button = el('button', 'crumb', crumb.name);
      button.type = 'button';
      button.disabled = index === crumbs.length - 1;
      button.prepend(icon(index ? 'folder' : 'drive'));
      button.addEventListener('click', () => {
        store.parentId = crumb.id;
        store.query = '';
        const input = $('#searchInput');
        if (input) input.value = '';
        persistScope();
        loadFiles();
      });
      fragment.append(button);
    });
    container.replaceChildren(fragment);
  }

  // Injects a sort dropdown next to the view switcher on first render.
  function renderToolbar() {
    const switcher = $('.view-switcher');
    if (!switcher || $('#sortButton')) return;
    const group = el('div', 'sort-group');
    group.style.cssText = 'display:flex;gap:3px;align-items:center;margin-right:6px;';
    const button = el('button', 'icon-button');
    button.id = 'sortButton';
    button.type = 'button';
    button.title = `${t('sort')}: ${t('sortName')}`;
    button.append(icon('list'));
    button.addEventListener('click', event => {
      event.stopPropagation();
      openSortMenu(button);
    });
    group.append(button);
    switcher.before(group);
  }

  function openSortMenu(anchor) {
    $$('.sort-popover').forEach(node => node.remove());
    const popover = el('div', 'sort-popover menu-popover');
    popover.style.cssText = 'display:block;position:absolute;z-index:60;top:44px;right:0;width:200px;';
    const options = [
      ['name', t('sortName')],
      ['modified', t('sortModified')],
      ['size', t('sortSize')]
    ];
    options.forEach(([field, label]) => {
      const button = el('button');
      button.type = 'button';
      const marker = store.sortField === field ? (store.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      button.append(icon('file'), document.createTextNode(label + marker));
      button.addEventListener('click', () => { setSort(field); popover.remove(); });
      popover.append(button);
    });
    const wrapper = anchor.parentElement;
    wrapper.style.position = 'relative';
    wrapper.append(popover);
    const dismiss = event => {
      if (!popover.contains(event.target)) { popover.remove(); document.removeEventListener('click', dismiss); }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  function fileType(item) {
    if (item.type === 'folder') return ['folder', 'folder'];
    const mime = item.mime || '';
    const ext = fileExtension(item.name);
    if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return ['image', 'image'];
    if (mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) return ['video', 'film'];
    if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) return ['video', 'film'];
    if (/pdf|word|sheet|presentation|text|json|zip/.test(mime) || TEXT_EXTENSIONS.includes(ext)) return ['document', 'doc'];
    return ['generic', 'file'];
  }

  function renderFiles() {
    const list = $('#fileList');
    const empty = $('#emptyState');
    if (!list || !empty) return;
    list.className = `file-grid${store.view === 'list' ? ' is-list' : ''}`;
    const items = sortedItems();
    const hasItems = items.length > 0;
    empty.hidden = hasItems;

    if (!hasItems) {
      list.replaceChildren();
      const searching = Boolean(store.query);
      const emptyTitle = $('#emptyTitle');
      const emptyDesc = $('#emptyDescription');
      if (emptyTitle) emptyTitle.textContent = searching ? t('noSearch') : t('emptyTitle');
      if (emptyDesc) emptyDesc.textContent = searching ? t('noSearchDesc') : t('emptyDescription');
      const emptyUpload = $('#emptyUploadButton');
      if (emptyUpload) emptyUpload.hidden = searching || store.scope === 'trash';
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => fragment.append(createFileCard(item, index)));
    list.replaceChildren(fragment);
  }

  function createFileCard(item, index) {
    const card = el('article', 'file-card');
    card.dataset.id = item.id;
    card.dataset.index = String(index);
    card.tabIndex = 0;
    if (store.selection.has(item.id)) card.classList.add('is-selected');
    card.addEventListener('contextmenu', event => { event.preventDefault(); openItemMenu(item, event.clientX, event.clientY); });

    const [kind, symbol] = fileType(item);
    const primary = el('button', 'file-card-main');
    primary.type = 'button';
    primary.title = item.name;
    const visual = el('span', `file-icon ${kind}`);
    visual.append(icon(symbol));

    // Lazy image thumbnails: only attempt for images with a streamable part.
    if (kind === 'image' && item.type === 'file') {
      const thumb = document.createElement('img');
      thumb.loading = 'lazy';
      thumb.alt = '';
      thumb.src = renderStreamUrl(item);
      thumb.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
      thumb.addEventListener('error', () => thumb.remove());
      visual.append(thumb);
    }

    const name = el('span', 'file-name', item.name);
    const meta = el('span', 'file-meta', item.type === 'folder'
      ? t('folder')
      : formatBytes(item.size));
    const date = el('span', 'list-date', formatRelative(item.updatedAt || item.createdAt));
    date.title = formatDate(item.updatedAt || item.createdAt);
    const size = el('span', 'list-size', item.type === 'folder' ? '—' : formatBytes(item.size));

    primary.append(visual, name, meta);
    primary.addEventListener('click', event => handleCardClick(event, item, index));
    card.append(primary, date, size);

    if (store.scope !== 'trash') {
      const star = el('button', `file-star${item.starred ? '' : ' is-empty'}`);
      star.type = 'button';
      star.title = item.starred ? t('removeStar') : t('addStar');
      star.append(icon('star'));
      star.addEventListener('click', event => {
        event.stopPropagation();
        mutateItem(item, 'star', { starred: !item.starred });
      });
      card.append(star);
    }

    const menu = el('div', 'file-menu');
    const trigger = el('button', 'icon-button menu-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', 'File actions');
    trigger.append(icon('more'));
    const popover = el('div', 'menu-popover');
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      $$('.file-menu.is-open').forEach(node => node.classList.remove('is-open'));
      menu.classList.toggle('is-open');
    });
    menu.append(trigger, popover);
    buildItemMenu(popover, item);
    card.append(menu);

    // Drag-to-move: folders are drop targets, every card is draggable.
    card.draggable = true;
    card.addEventListener('dragstart', event => {
      event.dataTransfer.setData('text/plain', item.id);
      event.dataTransfer.effectAllowed = 'move';
      if (item.type === 'folder') event.dataTransfer.setData('application/x-drive-folder', item.id);
    });
    if (item.type === 'folder') {
      card.addEventListener('dragover', event => {
        if (event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        card.classList.add('is-drop-target');
      });
      card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
      card.addEventListener('drop', async event => {
        card.classList.remove('is-drop-target');
        const sourceId = event.dataTransfer.getData('text/plain');
        if (!sourceId || sourceId === item.id) return;
        event.preventDefault();
        event.stopPropagation();
        const source = store.items.find(entry => entry.id === sourceId);
        if (source) await moveItems([source], item.id);
      });
    }
    return card;
  }

  function buildItemMenu(popover, item) {
    if (store.scope === 'trash') {
      addMenuButton(popover, 'restore', t('restore'), () => mutateItem(item, 'restore'));
      addMenuButton(popover, 'trash', t('deleteForever'), () => permanentlyDelete(item), true);
      return;
    }
    if (item.type === 'file') {
      if (previewKind(item)) addMenuButton(popover, 'file', t('preview'), () => openPreview(item));
      addMenuButton(popover, 'download', t('download'), () => downloadItem(item));
    }
    addMenuButton(popover, 'rename', t('rename'), () => openRename(item));
    addMenuButton(popover, 'star', item.starred ? t('removeStar') : t('addStar'), () => mutateItem(item, 'star', { starred: !item.starred }));
    if (item.type === 'file') {
      addMenuButton(popover, 'chevron', t('copyLink'), () => copyShareLink(item));
      addMenuButton(popover, 'file', t('copyName'), () => copyText(item.name, t('nameCopied')));
    }
    if (item.type === 'folder') addMenuButton(popover, 'chevron', t('move'), () => openMoveDialog([item]));
    addMenuButton(popover, 'trash', t('moveToTrash'), () => mutateItem(item, 'trash'), true);
  }

  function openItemMenu(item, x, y) {
    $$('.context-menu').forEach(node => node.remove());
    const menu = el('div', 'menu-popover context-menu');
    menu.style.cssText = `display:block;position:fixed;z-index:120;top:${y}px;left:${x}px;width:180px;`;
    buildItemMenu(menu, item);
    document.body.append(menu);
    const dismiss = event => {
      if (!menu.contains(event.target)) { menu.remove(); document.removeEventListener('click', dismiss); }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  function addMenuButton(parent, symbol, label, onClick, danger = false) {
    const button = el('button', danger ? 'danger' : '');
    button.type = 'button';
    button.append(icon(symbol), document.createTextNode(label));
    button.addEventListener('click', event => {
      event.stopPropagation();
      parent.closest('.file-menu')?.classList.remove('is-open');
      parent.remove();
      onClick();
    });
    parent.append(button);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Selection & navigation
  // ───────────────────────────────────────────────────────────────────────
  function handleCardClick(event, item, index) {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(item.id, index);
      return;
    }
    if (event.shiftKey && store.lastIndex >= 0) {
      selectRange(store.lastIndex, index);
      return;
    }
    if (store.selection.size > 1) {
      clearSelection();
    }
    store.lastIndex = index;
    openItem(item);
  }

  function toggleSelection(id, index) {
    if (store.selection.has(id)) store.selection.delete(id);
    else store.selection.add(id);
    store.lastIndex = index;
    emit();
  }

  function selectRange(from, to) {
    const items = sortedItems();
    const [start, end] = from <= to ? [from, to] : [to, from];
    for (let i = start; i <= end; i += 1) {
      if (items[i]) store.selection.add(items[i].id);
    }
    emit();
  }

  function clearSelection() {
    store.selection.clear();
    store.lastIndex = -1;
    emit();
  }

  function selectedItems() {
    return store.items.filter(item => store.selection.has(item.id));
  }

  function renderSelectionBar() {
    let bar = $('#selectionBar');
    const count = store.selection.size;
    if (!count) { bar?.remove(); return; }
    if (!bar) {
      bar = el('div', 'selection-bar');
      bar.id = 'selectionBar';
      bar.style.cssText = 'position:sticky;bottom:14px;z-index:40;display:flex;gap:8px;align-items:center;justify-content:space-between;margin:14px 0 0;padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-solid);box-shadow:var(--shadow);';
      $('#fileArea')?.append(bar);
    }
    const label = el('strong', '', `${count} ${t('selected')}`);
    const actions = el('div', '');
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    const trashScope = store.scope === 'trash';

    if (trashScope) {
      actions.append(actionButton('restore', t('bulkRestore'), () => bulkOperation('restore')));
      actions.append(actionButton('trash', t('bulkDelete'), () => bulkDelete(), true));
    } else {
      actions.append(actionButton('download', t('bulkDownload'), () => bulkDownload()));
      actions.append(actionButton('star', t('bulkStar'), () => bulkStar(true)));
      actions.append(actionButton('chevron', t('move'), () => openMoveDialog(selectedItems())));
      actions.append(actionButton('trash', t('bulkTrash'), () => bulkOperation('trash'), true));
    }
    actions.append(actionButton('close', t('clearSelection'), () => clearSelection()));
    bar.replaceChildren(label, actions);
  }

  function actionButton(symbol, label, onClick, danger = false) {
    const button = el('button', `button ${danger ? 'button-danger' : 'button-quiet'}`);
    button.type = 'button';
    if (danger) button.style.cssText = 'color:var(--danger);';
    button.append(icon(symbol), document.createTextNode(label));
    button.addEventListener('click', onClick);
    return button;
  }

  // ───────────────────────────────────────────────────────────────────────
  // Item actions
  // ───────────────────────────────────────────────────────────────────────
  function openFolder(item) {
    store.scope = 'files';
    store.parentId = item.id;
    store.query = '';
    const input = $('#searchInput');
    if (input) input.value = '';
    persistScope();
    loadFiles();
  }
  function openItem(item) {
    if (item.type === 'folder') openFolder(item);
    else if (previewKind(item)) openPreview(item);
    else downloadItem(item);
  }
  function persistScope() {
    writePref('scope', store.scope);
    writePref('parentId', store.parentId);
  }

  async function createFolder(name) {
    try {
      await api('/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId: store.parentId })
      });
      toast(t('folderCreated', { name }), 'success');
      await refreshFiles();
    } catch (error) { notifyError(error); }
  }

  async function mutateItem(item, operation, details = {}) {
    try {
      await api(`/files/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, ...details })
      });
      const message = operation === 'trash' ? t('movedToTrash')
        : operation === 'restore' ? t('restored') : t('renamed');
      toast(message, 'success');
      await refreshFiles();
    } catch (error) { notifyError(error); }
  }

  async function permanentlyDelete(item) {
    if (!window.confirm(t('confirmDelete', { name: item.name }))) return;
    try {
      await api(`/files/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      toast(t('deleted'), 'success');
      await refreshFiles();
    } catch (error) { notifyError(error); }
  }

  async function bulkOperation(operation) {
    const items = selectedItems();
    if (!items.length) return;
    const tasks = items.map(item => api(`/files/${encodeURIComponent(item.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation })
    }).catch(() => null));
    await Promise.allSettled(tasks);
    toast(t(operation === 'trash' ? 'movedToTrash' : 'restored'), 'success');
    clearSelection();
    await refreshFiles();
  }

  async function bulkDelete() {
    const items = selectedItems();
    if (!items.length) return;
    if (!window.confirm(t('confirmDelete', { name: `${items.length} ${t('selected')}` }))) return;
    await Promise.allSettled(items.map(item =>
      api(`/files/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => null)));
    toast(t('deleted'), 'success');
    clearSelection();
    await refreshFiles();
  }

  async function bulkStar(starred) {
    const items = selectedItems();
    await Promise.allSettled(items.map(item =>
      api(`/files/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'star', starred })
      }).catch(() => null)));
    clearSelection();
    await refreshFiles();
  }

  async function bulkDownload() {
    const items = selectedItems().filter(item => item.type === 'file');
    for (const item of items) {
      await downloadItem(item);
      await sleep(400);
    }
  }

  // Move support: best-effort — the Worker accepts a "move" operation with parentId.
  async function moveItems(items, targetParentId) {
    await Promise.allSettled(items.map(item =>
      api(`/files/${encodeURIComponent(item.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'move', parentId: targetParentId })
      }).catch(() => null)));
    toast(t('moveSuccess', { count: items.length }), 'success');
    clearSelection();
    await refreshFiles();
  }

  // Folder picker for the move dialog.
  async function openMoveDialog(items) {
    if (!items.length) return;
    store.pendingMove = items;
    const modal = ensureMoveModal();
    const list = $('#moveList', modal);
    list.replaceChildren(el('p', '', t('loadingPreview')));
    modal.hidden = false;
    try {
      const data = await api('/files?scope=files');
      const folders = (Array.isArray(data.items) ? data.items : []).filter(item => item.type === 'folder');
      const fragment = document.createDocumentFragment();
      const rootButton = el('button', 'button button-quiet', t('moveRoot'));
      rootButton.type = 'button';
      rootButton.style.cssText = 'width:100%;margin-bottom:6px;';
      rootButton.addEventListener('click', async () => {
        modal.hidden = true;
        await moveItems(store.pendingMove, null);
      });
      fragment.append(rootButton);
      folders.forEach(folder => {
        const button = el('button', 'button button-quiet', folder.name);
        button.type = 'button';
        button.style.cssText = 'width:100%;margin-bottom:6px;justify-content:flex-start;';
        button.prepend(icon('folder'));
        button.addEventListener('click', async () => {
          modal.hidden = true;
          await moveItems(store.pendingMove, folder.id);
        });
        fragment.append(button);
      });
      if (!folders.length && !store.pendingMove.length) fragment.append(el('p', '', t('emptyTitle')));
      list.replaceChildren(fragment);
    } catch (error) {
      list.replaceChildren(el('p', '', t('loadError')));
      notifyError(error);
    }
  }

  function ensureMoveModal() {
    let modal = $('#moveModal');
    if (modal) return modal;
    modal = el('div', 'modal-backdrop');
    modal.id = 'moveModal';
    modal.hidden = true;
    const card = el('div', 'modal small-modal');
    const header = el('div', 'modal-header');
    const wrap = el('div');
    wrap.append(el('p', 'eyebrow', 'TELEGRAM DRIVE'), el('h2', '', t('moveTitle')));
    const close = el('button', 'icon-button');
    close.type = 'button';
    close.append(icon('close'));
    close.addEventListener('click', () => { modal.hidden = true; });
    header.append(wrap, close);
    const help = el('p', 'form-help', t('moveHelp'));
    const list = el('div');
    list.id = 'moveList';
    list.style.cssText = 'max-height:52vh;overflow:auto;margin-top:12px;';
    card.append(header, help, list);
    modal.append(card);
    modal.addEventListener('click', event => { if (event.target === modal) modal.hidden = true; });
    document.body.append(modal);
    return modal;
  }

  async function copyShareLink(item) {
    const url = `${location.origin}${location.pathname}#file=${encodeURIComponent(item.id)}`;
    await copyText(url, t('linkCopied'));
  }
  async function copyText(value, message) {
    try { await navigator.clipboard.writeText(value); toast(message, 'success'); }
    catch { toast(t('requestFailed'), 'error'); }
  }

  function openNewFolder() {
    openPrompt({
      title: t('newFolderTitle'),
      label: t('newFolderLabel'),
      help: t('newFolderHelp'),
      submit: t('save'),
      value: '',
      onSubmit: createFolder
    });
  }
  function openRename(item) {
    openPrompt({
      title: t('renameTitle'),
      label: t('renameLabel'),
      help: '',
      submit: t('saveName'),
      value: item.name,
      onSubmit: name => mutateItem(item, 'rename', { name })
    });
  }
  function openPrompt({ title, label, help, submit, value, onSubmit }) {
    $('#promptTitle').textContent = title;
    $('#promptLabel').textContent = label;
    $('#promptHelp').textContent = help;
    $('#promptSubmit').textContent = submit;
    $('#promptInput').value = value;
    store.promptHandler = onSubmit;
    openModal('promptModal');
    setTimeout(() => $('#promptInput').select(), 0);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Data-plane access (Render)
  // ───────────────────────────────────────────────────────────────────────
  function orderedParts(item) {
    return Array.isArray(item.parts) && item.parts.length
      ? [...item.parts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      : null;
  }
  function primaryFileId(item) {
    return orderedParts(item)?.[0]?.fileId || item.telegram_file_id || item.id;
  }
  function renderPartUrl(fileId) {
    return `${RENDER_URL}/file/${encodeURIComponent(fileId)}?token=${encodeURIComponent(store.token)}`;
  }
  function renderStreamUrl(item) {
    return renderPartUrl(primaryFileId(item));
  }

  async function fetchRenderPart(fileId, signal) {
    const response = await fetch(renderPartUrl(fileId), {
      headers: { 'X-Drive-Token': store.token },
      signal
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    if (blob.size === 0) {
      const error = new Error(t('previewTooBig'));
      error.status = 502;
      throw error;
    }
    return blob;
  }

  async function fetchPartsInOrder(parts, signal) {
    const blobs = new Array(parts.length);
    let cursor = 0;
    async function worker() {
      while (cursor < parts.length) {
        const index = cursor++;
        blobs[index] = await fetchRenderPart(parts[index].fileId, signal);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, parts.length) }, worker)
    );
    return blobs;
  }

  async function fetchItemBlob(item, signal) {
    const parts = orderedParts(item);
    if (!parts || parts.length <= 1) return fetchRenderPart(primaryFileId(item), signal);
    const blobs = await fetchPartsInOrder(parts, signal);
    return new Blob(blobs, { type: item.mime || 'application/octet-stream' });
  }

  async function downloadItem(item) {
    toast(t('downloaded'), 'info');
    try {
      const blob = await fetchItemBlob(item);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (error) { notifyError(error); }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Upload pipeline
  // ───────────────────────────────────────────────────────────────────────
  async function handleFiles(files) {
    const entries = [...files].filter(file => file.size > 0);
    if (!entries.length) return;
    if (store.scope !== 'files') {
      store.scope = 'files';
      store.parentId = null;
      persistScope();
      toast(t('uploadingToRoot'), 'info');
    }
    const tray = $('#uploadTray');
    if (tray) tray.hidden = false;
    for (const file of entries) {
      createUploadTask(file);
    }
    await refreshFiles();
  }

  function scheduleProgressFlush(row, value, label) {
    row._pendingProgress = { value, label };
    if (row._rafScheduled) return;
    row._rafScheduled = true;
    requestAnimationFrame(() => {
      const pending = row._pendingProgress;
      row._rafScheduled = false;
      if (pending) setUploadProgress(row, pending.value, pending.label);
    });
  }

  // Each upload becomes a task object so it can be paused/resumed/cancelled.
  function createUploadTask(file) {
    const row = createUploadRow(file);
    const task = {
      file,
      row,
      chunkProgress: [],
      parts: [],
      paused: false,
      cancelled: false,
      startedAt: Date.now(),
      total: Math.max(1, Math.ceil(file.size / CHUNK_SIZE))
    };
    task.chunkProgress = new Array(task.total).fill(0);
    runUploadTask(task);
    return task;
  }

  async function runUploadTask(task) {
    const { file, row } = task;
    store.uploadingCount += 1;
    const updateProgress = () => {
      const overall = Math.round(task.chunkProgress.reduce((sum, value) => sum + value, 0) / task.total);
      const completed = task.chunkProgress.filter(value => value === 100).length;
      const elapsed = (Date.now() - task.startedAt) / 1000;
      const eta = overall > 3 ? (elapsed / overall) * (100 - overall) : NaN;
      const label = task.paused
        ? t('uploadPaused')
        : t('uploadingPart', { current: Math.min(completed + 1, task.total), total: task.total })
          + (Number.isFinite(eta) ? ` · ${t('eta', { time: formatDuration(eta) })}` : '');
      scheduleProgressFlush(row, overall, label);
    };

    try {
      for (let start = 0; start < task.total; start += UPLOAD_CONCURRENCY) {
        while (task.paused && !task.cancelled) await sleep(250);
        if (task.cancelled) throw Object.assign(new Error(t('uploadCancelled')), { cancelled: true });

        const batch = [];
        for (let offset = 0; offset < UPLOAD_CONCURRENCY && (start + offset) < task.total; offset += 1) {
          const index = start + offset;
          const slice = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
          const filename = `${file.name}.part-${String(index + 1).padStart(4, '0')}`;
          batch.push((async () => {
            const part = await uploadChunkWithRetry(
              slice, filename, task,
              percent => { task.chunkProgress[index] = percent; updateProgress(); }
            );
            task.chunkProgress[index] = 100;
            updateProgress();
            task.parts[index] = {
              fileId: part.telegram_file_id,
              messageId: part.telegram_message_id,
              size: part.size || slice.size,
              index
            };
          })());
        }
        await Promise.all(batch);
        if (start + UPLOAD_CONCURRENCY < task.total) await sleep(INTER_CHUNK_DELAY_MS);
      }

      await api('/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          parentId: store.parentId,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          parts: task.parts.filter(Boolean)
        })
      });
      setUploadProgress(row, 100, t('completed'));
      row.classList.add('completed');
      toast(t('uploadSuccess', { name: file.name }), 'success');
      await refreshFiles();
    } catch (error) {
      if (error.cancelled) {
        row.classList.add('error');
        setUploadProgress(row, 0, t('uploadCancelled'));
        await cleanupUploadedParts(task.parts.filter(Boolean));
      } else {
        row.classList.add('error');
        setUploadProgress(row, 100, error.message || t('requestFailed'));
        await cleanupUploadedParts(task.parts.filter(Boolean));
        notifyError(error);
      }
    } finally {
      store.uploadingCount -= 1;
      setTimeout(() => {
        if (row.classList.contains('completed')) {
          row.style.opacity = '0';
          setTimeout(() => row.remove(), 300);
        }
      }, 3_000);
    }
  }

  function createUploadRow(file) {
    const row = el('div', 'upload-row');
    const name = el('span', 'upload-name', file.name);
    const controls = el('div', '');
    controls.style.cssText = 'display:flex;gap:4px;';
    const pause = el('button', 'icon-button');
    pause.type = 'button';
    pause.title = t('pauseUpload');
    pause.style.cssText = 'width:24px;height:24px;';
    pause.append(icon('clock'));
    const cancel = el('button', 'icon-button');
    cancel.type = 'button';
    cancel.title = t('cancelUpload');
    cancel.style.cssText = 'width:24px;height:24px;';
    cancel.append(icon('close'));

    const status = el('div', 'upload-status');
    const label = el('span', '', t('preparing'));
    const percentage = el('span', 'upload-percent', '0%');
    status.append(label, percentage);
    const track = el('div', 'progress-track');
    const fill = document.createElement('i');
    track.append(fill);

    const header = el('div', '');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    header.append(name, controls);
    row.append(header, status, track);

    pause.addEventListener('click', () => {
      row._task.paused = !row._task.paused;
      pause.title = row._task.paused ? t('resumeUpload') : t('pauseUpload');
      setUploadProgress(row, row._lastValue || 0, row._task.paused ? t('uploadPaused') : t('preparing'));
    });
    cancel.addEventListener('click', () => {
      row._task.cancelled = true;
      row._task.paused = false;
    });

    $('#uploadQueue').prepend(row);
    // Defer so we can attach the task after it is created.
    queueMicrotask(() => { row._task = currentTask; });
    return row;
  }
  let currentTask = null;

  function setUploadProgress(row, value, label) {
    row._lastValue = value;
    const fill = $('.progress-track i', row);
    const percent = $('.upload-percent', row);
    const labelNode = $('.upload-status span', row);
    if (fill) fill.style.width = `${clamp(value, 0, 100)}%`;
    if (percent) percent.textContent = `${Math.round(value)}%`;
    if (labelNode) labelNode.textContent = label;
  }

  async function uploadChunkWithRetry(blob, filename, task, onProgress) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
      try {
        if (task?.cancelled) throw Object.assign(new Error(t('uploadCancelled')), { cancelled: true });
        return await uploadChunkOnce(blob, filename, onProgress);
      } catch (error) {
        if (error.cancelled) throw error;
        lastError = error;
        if (attempt < MAX_RETRY) {
          const base = RETRY_BASE_MS * 2 ** attempt;
          const jitter = Math.random() * RETRY_JITTER_MS;
          const seconds = Math.round((base + jitter) / 1000);
          toast(t(error.status === 429 ? 'waitingFlood' : 'waitingRetry',
            { seconds, attempt: attempt + 1, max: MAX_RETRY }), 'info');
          await sleep(base + jitter);
        }
      }
    }
    throw lastError;
  }

  function uploadChunkOnce(blob, filename, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const form = new FormData();
      form.append('file', blob, filename);
      form.append('filename', filename);
      xhr.open('POST', `${RENDER_URL}/upload`);
      xhr.setRequestHeader('X-Drive-Token', store.token);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(event.loaded / event.total * 100);
      };
      xhr.onerror = () => reject(new Error(t('networkError')));
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data);
        else {
          const error = new Error(data.error || t('requestFailed'));
          error.status = xhr.status;
          reject(error);
        }
      };
      xhr.send(form);
    });
  }

  async function cleanupUploadedParts(parts) {
    await Promise.allSettled(parts.map(part =>
      fetch(`${RENDER_URL}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Drive-Token': store.token },
        body: JSON.stringify({ message_id: part.messageId })
      }).catch(() => {})));
  }

  // ───────────────────────────────────────────────────────────────────────
  // Preview
  // ───────────────────────────────────────────────────────────────────────
  const PREVIEW_EXTENSIONS = {
    image: IMAGE_EXTENSIONS,
    video: VIDEO_EXTENSIONS,
    audio: AUDIO_EXTENSIONS,
    text: TEXT_EXTENSIONS
  };

  function previewKind(item) {
    if (!item || item.type !== 'file') return null;
    const mime = item.mime || '';
    const ext = fileExtension(item.name);
    if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return 'image';
    if (mime.startsWith('video/') || VIDEO_EXTENSIONS.includes(ext)) return 'video';
    if (mime.startsWith('audio/') || AUDIO_EXTENSIONS.includes(ext)) return 'audio';
    if (mime.startsWith('text/') || TEXT_EXTENSIONS.includes(ext)) return 'text';
    return null;
  }

  let previewModalEl = null;
  let previewAbortController = null;
  let previewGallery = [];
  let previewGalleryIndex = -1;
  let previewTransform = { scale: 1, rotation: 0 };

  function buildPreviewModal() {
    const backdrop = el('div', 'modal-backdrop');
    backdrop.id = 'previewModal';
    backdrop.hidden = true;
    backdrop.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:1000;';

    const modal = el('div', 'modal');
    modal.style.cssText = 'background:var(--surface-solid,#fff);border-radius:14px;max-width:min(92vw,1100px);max-height:90vh;width:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);';

    const header = el('div', 'modal-header');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(120,120,120,.2);gap:12px;';
    const title = el('h2', '', '');
    title.id = 'previewTitle';
    title.style.cssText = 'font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    const tools = el('div', '');
    tools.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const prev = el('button', 'icon-button');
    prev.type = 'button';
    prev.id = 'previewPrev';
    prev.append(icon('chevron'));
    prev.style.transform = 'rotate(180deg)';
    prev.title = '←';
    prev.addEventListener('click', () => navigateGallery(-1));
    const next = el('button', 'icon-button');
    next.type = 'button';
    next.id = 'previewNext';
    next.append(icon('chevron'));
    next.title = '→';
    next.addEventListener('click', () => navigateGallery(1));
    const zoomOut = el('button', 'icon-button');
    zoomOut.type = 'button';
    zoomOut.append(icon('close'));
    zoomOut.title = t('zoomOut');
    zoomOut.addEventListener('click', () => applyTransform(-0.2));
    const zoomIn = el('button', 'icon-button');
    zoomIn.type = 'button';
    zoomIn.append(icon('plus'));
    zoomIn.title = t('zoomIn');
    zoomIn.addEventListener('click', () => applyTransform(0.2));
    const rotate = el('button', 'icon-button');
    rotate.type = 'button';
    rotate.append(icon('restore'));
    rotate.title = t('rotate');
    rotate.addEventListener('click', () => { previewTransform.rotation = (previewTransform.rotation + 90) % 360; applyTransform(0); });
    const closeButton = el('button', 'icon-button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.append(icon('close'));
    closeButton.addEventListener('click', closePreview);

    tools.append(prev, next, zoomOut, zoomIn, rotate, closeButton);
    header.append(title, tools);

    const body = el('div', 'modal-body');
    body.id = 'previewBody';
    body.style.cssText = 'padding:0;overflow:auto;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.03);min-height:200px;flex:1;';
    modal.append(header, body);
    backdrop.append(modal);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closePreview(); });
    document.body.append(backdrop);
    return backdrop;
  }

  function ensurePreviewModal() {
    if (!previewModalEl) previewModalEl = buildPreviewModal();
    return previewModalEl;
  }

  function applyTransform(deltaScale) {
    previewTransform.scale = clamp(previewTransform.scale + deltaScale, 0.2, 6);
    const media = $('#previewBody img, #previewBody video');
    if (media) {
      media.style.transform = `scale(${previewTransform.scale}) rotate(${previewTransform.rotation}deg)`;
      media.style.transition = 'transform .18s ease';
    }
  }

  function navigateGallery(direction) {
    if (previewGallery.length <= 1) return;
    previewGalleryIndex = (previewGalleryIndex + direction + previewGallery.length) % previewGallery.length;
    openPreview(previewGallery[previewGalleryIndex], { keepGallery: true });
  }

  function closePreview() {
    const modal = ensurePreviewModal();
    const body = $('#previewBody', modal);
    const activeMedia = $('video, audio', body);
    if (activeMedia) {
      activeMedia.pause();
      activeMedia.removeAttribute('src');
      activeMedia.load();
    }
    modal.hidden = true;
    if (body) body.replaceChildren();
    previewAbortController?.abort();
    previewAbortController = null;
    previewTransform = { scale: 1, rotation: 0 };
  }

  function buildTextPreview(text, extension) {
    const container = el('div');
    container.style.cssText = 'width:100%;display:flex;flex-direction:column;max-height:78vh;';

    const toolbar = el('div');
    toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid rgba(120,120,120,.15);font-size:12px;';
    const badge = el('span', '', LANGUAGE_LABEL[extension] || (extension ? extension.toUpperCase() : 'Text'));
    badge.style.cssText = 'opacity:.6;text-transform:uppercase;letter-spacing:.05em;';
    const actions = el('div', '');
    actions.style.cssText = 'display:flex;gap:10px;';

    const wrapButton = el('button', '', t('wrapLines'));
    wrapButton.type = 'button';
    wrapButton.style.cssText = 'border:none;background:transparent;cursor:pointer;color:inherit;opacity:.75;font:inherit;';
    const copyButton = el('button', '', t('copy'));
    copyButton.type = 'button';
    copyButton.style.cssText = 'border:none;background:transparent;cursor:pointer;color:inherit;opacity:.75;font:inherit;';
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyButton.textContent = t('copied');
        setTimeout(() => { copyButton.textContent = t('copy'); }, 1_500);
      } catch { /* clipboard unavailable */ }
    });
    actions.append(wrapButton, copyButton);
    toolbar.append(badge, actions);
    container.append(toolbar);

    const codeArea = el('div');
    codeArea.style.cssText = 'overflow:auto;flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;';

    // CSV gets a real table; JSON gets pretty-printed.
    if (extension === 'csv') {
      codeArea.append(buildCsvTable(text));
    } else if (extension === 'json') {
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      codeArea.append(buildNumberedCode(pretty));
    } else {
      codeArea.append(buildNumberedCode(text));
    }

    wrapButton.addEventListener('click', () => {
      const pre = $('ol, pre', codeArea);
      if (pre) pre.style.whiteSpace = pre.style.whiteSpace === 'pre' ? 'pre-wrap' : 'pre';
    });

    container.append(codeArea);
    return container;
  }

  function buildNumberedCode(text) {
    const lines = text.split('\n');
    if (lines.length <= TEXT_PREVIEW_LINE_LIMIT) {
      const ol = document.createElement('ol');
      ol.style.cssText = 'margin:0;padding:14px 18px 14px 3.4em;white-space:pre-wrap;word-break:break-word;';
      const fragment = document.createDocumentFragment();
      lines.forEach(lineText => {
        const li = document.createElement('li');
        li.textContent = lineText;
        fragment.append(li);
      });
      ol.append(fragment);
      return ol;
    }
    const wrapper = el('div');
    const notice = el('p', '', t('truncatedNotice'));
    notice.style.cssText = 'margin:0;padding:8px 16px;font-size:12px;opacity:.65;';
    const pre = el('pre');
    pre.style.cssText = 'margin:0;padding:0 18px 18px;white-space:pre-wrap;word-break:break-word;';
    pre.append(el('code', '', text));
    wrapper.append(notice, pre);
    return wrapper;
  }

  function buildCsvTable(text) {
    const rows = text.split(/\r?\n/).filter(Boolean).map(row => row.split(','));
    const table = el('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';
    rows.slice(0, 500).forEach((row, rowIndex) => {
      const tr = el('tr');
      row.forEach(cell => {
        const td = el(rowIndex === 0 ? 'th' : 'td', '', cell);
        td.style.cssText = `padding:6px 10px;border-bottom:1px solid rgba(120,120,120,.15);text-align:left;${rowIndex === 0 ? 'position:sticky;top:0;background:var(--surface-solid);' : ''}`;
        tr.append(td);
      });
      table.append(tr);
    });
    return table;
  }

  async function openPreview(item, { keepGallery = false } = {}) {
    const kind = previewKind(item);
    if (!kind) { downloadItem(item); return; }

    if (!keepGallery) {
      previewGallery = sortedItems().filter(entry => entry.type === 'file' && previewKind(entry));
      previewGalleryIndex = previewGallery.findIndex(entry => entry.id === item.id);
    }

    previewAbortController?.abort();
    const controller = new AbortController();
    previewAbortController = controller;

    const modal = ensurePreviewModal();
    const body = $('#previewBody', modal);
    const title = $('#previewTitle', modal);
    title.textContent = previewGallery.length > 1
      ? `${item.name} — ${previewGalleryIndex + 1} ${t('of')} ${previewGallery.length}`
      : item.name;
    $('#previewPrev', modal).style.visibility = previewGallery.length > 1 ? 'visible' : 'hidden';
    $('#previewNext', modal).style.visibility = previewGallery.length > 1 ? 'visible' : 'hidden';
    body.replaceChildren(el('p', '', t('loadingPreview')));
    modal.hidden = false;
    previewTransform = { scale: 1, rotation: 0 };

    if (kind === 'text') {
      try {
        const blob = await fetchItemBlob(item, controller.signal);
        if (blob.size > TEXT_PREVIEW_BYTE_LIMIT) {
          const text = await blob.slice(0, TEXT_PREVIEW_BYTE_LIMIT).text();
          body.replaceChildren(buildTextPreview(`${text}\n\n… (truncated)`, fileExtension(item.name)));
        } else {
          const text = await blob.text();
          body.replaceChildren(buildTextPreview(text, fileExtension(item.name)));
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        body.replaceChildren(el('p', '', error.status === 401 ? t('wrongPassword') : t('previewFailed')));
        if (error.status === 401) handleExpiredSession();
      }
      return;
    }

    let media;
    if (kind === 'image') {
      media = document.createElement('img');
      media.alt = item.name;
      media.style.cssText = 'max-width:100%;max-height:78vh;display:block;object-fit:contain;cursor:zoom-in;';
      let zoomed = false;
      media.addEventListener('click', () => {
        zoomed = !zoomed;
        media.style.transform = zoomed ? 'scale(1.6)' : `scale(${previewTransform.scale}) rotate(${previewTransform.rotation}deg)`;
        media.style.transition = 'transform .2s ease';
        media.style.cursor = zoomed ? 'zoom-out' : 'zoom-in';
      });
    } else if (kind === 'video') {
      media = document.createElement('video');
      media.controls = true;
      media.autoplay = false;
      media.style.cssText = 'max-width:100%;max-height:78vh;display:block;background:#000;';
    } else {
      media = document.createElement('audio');
      media.controls = true;
      media.style.cssText = 'width:100%;padding:32px;';
    }
    media.addEventListener('error', () => {
      body.replaceChildren(el('p', '', t('previewFailed')));
    });
    media.src = renderStreamUrl(item);
    body.replaceChildren(media);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Toasts & modals
  // ───────────────────────────────────────────────────────────────────────
  let lastToastKey = '';
  let lastToastAt = 0;
  function toast(message, type = 'info') {
    const key = `${type}:${message}`;
    const now = Date.now();
    if (key === lastToastKey && now - lastToastAt < 1_200) return;
    lastToastKey = key;
    lastToastAt = now;
    const entry = el('div', `toast ${type}`);
    entry.append(
      icon(type === 'success' ? 'drive' : type === 'error' ? 'close' : 'files'),
      el('p', '', message)
    );
    const stack = $('#toastStack');
    if (!stack) return;
    stack.append(entry);
    setTimeout(() => {
      entry.style.opacity = '0';
      entry.style.transform = 'translateY(-8px)';
      setTimeout(() => entry.remove(), 220);
    }, 4_200);
  }

  function notifyError(error) {
    if (error.status === 401) { handleExpiredSession(); return; }
    const message = error.message === 'Failed to fetch' ? t('networkError')
      : error.message || t('requestFailed');
    toast(message, 'error');
  }

  function openModal(id) { const node = $(`#${id}`); if (node) node.hidden = false; }
  function closeModal(id) { const node = $(`#${id}`); if (node) node.hidden = true; }

  function showLogin() {
    const passwordField = $('#password');
    if (passwordField) passwordField.value = '';
    const modal = $('#loginModal');
    if (modal) modal.hidden = false;
    passwordField?.focus();
  }

  function handleExpiredSession() {
    sessionStorage.removeItem(KEYS.token);
    store.token = '';
    clearListCache();
    showLogin();
    toast(t('wrongPassword'), 'error');
  }

  function signOut() {
    if (!window.confirm(t('confirmSignOut'))) return;
    sessionStorage.removeItem(KEYS.token);
    store.token = '';
    clearListCache();
    showLogin();
  }

  function hideWorkerUrlConfig() {
    const apiUrlField = $('#apiUrl');
    if (apiUrlField) {
      const label = apiUrlField.closest('label') || apiUrlField.previousElementSibling;
      if (label && label.tagName === 'LABEL') label.hidden = true;
      apiUrlField.hidden = true;
      apiUrlField.removeAttribute('required');
    }
    $('#settingsButton')?.setAttribute('hidden', 'hidden');
    $('#settingsModal')?.setAttribute('hidden', 'hidden');
  }

  // ───────────────────────────────────────────────────────────────────────
  // Keyboard navigation
  // ───────────────────────────────────────────────────────────────────────
  function focusCard(index) {
    const cards = $$('.file-card');
    if (!cards.length) return;
    const target = cards[clamp(index, 0, cards.length - 1)];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
    store.lastIndex = clamp(index, 0, cards.length - 1);
  }

  function handleKeydown(event) {
    const tag = (event.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || event.target.isContentEditable;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      $('#searchInput')?.focus();
      return;
    }
    if (event.key === '/' && !typing) {
      event.preventDefault();
      $('#searchInput')?.focus();
      return;
    }
    if (event.key === 'Escape') {
      $$('.file-menu.is-open').forEach(menu => menu.classList.remove('is-open'));
      $$('.context-menu, .sort-popover').forEach(node => node.remove());
      closeModal('promptModal');
      closePreview();
      if (store.selection.size) clearSelection();
      const search = $('#searchInput');
      if (search && document.activeElement === search) search.blur();
      return;
    }
    if (typing) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      sortedItems().forEach((item, index) => {
        store.selection.add(item.id);
        store.lastIndex = index;
      });
      emit();
      return;
    }
    if (event.key === 'Delete' && store.selection.size && store.scope !== 'trash') {
      bulkOperation('trash');
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusCard(store.lastIndex + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusCard(store.lastIndex - 1);
    } else if (event.key === 'Enter') {
      const items = sortedItems();
      const item = items[store.lastIndex];
      if (item && document.activeElement?.classList.contains('file-card')) openItem(item);
    } else if (event.key === ' ') {
      if (document.activeElement?.classList.contains('file-card')) {
        event.preventDefault();
        const items = sortedItems();
        const item = items[store.lastIndex];
        if (item) toggleSelection(item.id, store.lastIndex);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Network awareness
  // ───────────────────────────────────────────────────────────────────────
  function setupNetworkWatcher() {
    window.addEventListener('offline', () => {
      store.isOffline = true;
      emit();
      toast(t('offline'), 'error');
    });
    window.addEventListener('online', () => {
      store.isOffline = false;
      emit();
      toast(t('backOnline'), 'success');
      if (store.token) refreshFiles();
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Event binding
  // ───────────────────────────────────────────────────────────────────────
  function bindEvents() {
    const loginForm = $('#loginForm');
    loginForm?.addEventListener('submit', async event => {
      event.preventDefault();
      const password = $('#password').value;
      const button = $('#loginButton');
      if (button) button.disabled = true;
      try {
        const response = await fetch(`${API_URL}/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) {
          const error = new Error(data.error || t('wrongPassword'));
          error.status = response.status;
          throw error;
        }
        store.token = data.token;
        sessionStorage.setItem(KEYS.token, data.token);
        const modal = $('#loginModal');
        if (modal) modal.hidden = true;
        await loadFiles();
      } catch (error) {
        const message = error.status === 401 ? t('wrongPassword')
          : error.message === 'Failed to fetch' ? t('networkError')
            : error.message;
        toast(message, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });

    $('#passwordToggle')?.addEventListener('click', () => {
      const field = $('#password');
      field.type = field.type === 'password' ? 'text' : 'password';
    });

    $$('[data-close-modal]').forEach(button =>
      button.addEventListener('click', () => closeModal(button.dataset.closeModal)));

    $('#promptForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const name = $('#promptInput').value.trim();
      if (!name) return;
      const action = store.promptHandler;
      closeModal('promptModal');
      store.promptHandler = null;
      action?.(name);
    });

    $$('.nav-item').forEach(button => button.addEventListener('click', () => {
      store.scope = button.dataset.scope;
      store.parentId = null;
      store.query = '';
      const input = $('#searchInput');
      if (input) input.value = '';
      persistScope();
      loadFiles();
    }));

    const pickFile = () => $('#fileInput').click();
    $('#uploadButton')?.addEventListener('click', pickFile);
    $('#uploadButtonMobile')?.addEventListener('click', pickFile);
    $('#emptyUploadButton')?.addEventListener('click', pickFile);
    $('#fileInput')?.addEventListener('change', event => {
      handleFiles(event.target.files);
      event.target.value = '';
    });

    $('#newFolderButton')?.addEventListener('click', openNewFolder);
    $('#closeUploadTray')?.addEventListener('click', () => {
      const tray = $('#uploadTray');
      if (tray) tray.hidden = true;
    });

    $$('.view-switcher [data-view]').forEach(button => button.addEventListener('click', () => {
      store.view = button.dataset.view;
      localStorage.setItem(KEYS.view, store.view);
      $$('.view-switcher [data-view]').forEach(node =>
        node.classList.toggle('is-active', node === button));
      renderFiles();
    }));

    const searchInput = $('#searchInput');
    const runSearch = debounce(() => {
      store.query = searchInput.value.trim();
      loadFiles();
    }, 260);
    searchInput?.addEventListener('input', runSearch);

    $('#languageButton')?.addEventListener('click', () => {
      store.lang = store.lang === 'vi' ? 'en' : 'vi';
      localStorage.setItem(KEYS.lang, store.lang);
      render();
    });
    $('#themeButton')?.addEventListener('click', () => {
      store.theme = store.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(KEYS.theme, store.theme);
      applyTranslations();
    });
    $('#accountButton')?.addEventListener('click', signOut);

    const fileArea = $('#fileArea');
    if (fileArea) {
      ['dragenter', 'dragover'].forEach(type => fileArea.addEventListener(type, event => {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          fileArea.classList.add('is-dragging');
        }
      }));
      ['dragleave', 'drop'].forEach(type => fileArea.addEventListener(type, event => {
        event.preventDefault();
        fileArea.classList.remove('is-dragging');
      }));
      fileArea.addEventListener('drop', event => {
        if (event.dataTransfer?.files?.length) handleFiles(event.dataTransfer.files);
      });
    }

    $('#mobileMenu')?.addEventListener('click', () => $('.sidebar')?.classList.toggle('is-open'));
    document.addEventListener('click', () => {
      $$('.file-menu.is-open').forEach(menu => menu.classList.remove('is-open'));
    });
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('beforeunload', event => {
      if (store.uploadingCount > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Boot
  // ───────────────────────────────────────────────────────────────────────
  function initialise() {
    hideWorkerUrlConfig();
    ensurePreviewModal();
    bindEvents();
    setupNetworkWatcher();
    subscribe(render);
    $$('.view-switcher [data-view]').forEach(button =>
      button.classList.toggle('is-active', button.dataset.view === store.view));
    applyTranslations();
    render();
    if (store.token) loadFiles(); else showLogin();
  }

  initialise();
})();
