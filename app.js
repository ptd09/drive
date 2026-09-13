/* Telegram Drive frontend (v3) — no framework or build step required. */
(() => {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // 1) FIXED WORKER — no URL input/config is exposed in the UI anymore.
  //    The app always talks to this single Worker. Any #apiUrl / settings
  //    elements still present in index.html are hidden at boot (see
  //    hideWorkerUrlConfig()) instead of requiring an HTML edit.
  // ───────────────────────────────────────────────────────────────────────
  const API_URL = 'https://drive-worker.phamdatt140613.workers.dev';

  const CHUNK_SIZE = 50 * 1024 * 1024;   
  const INTER_CHUNK_DELAY_MS = 1_200;    // Pace uploads to avoid Telegram flood control (429).
  const MAX_RETRY = 5;                   // 2s, 4s, 8s, 16s, 32s.
  const RETRY_BASE_MS = 2_000;

  const KEYS = { lang: 'telegramDrive.lang', theme: 'telegramDrive.theme', view: 'telegramDrive.view', token: 'telegramDrive.session' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const COPY = {
    vi: {
      upload: 'Tải tệp lên', myFiles: 'Tệp của tôi', recent: 'Gần đây', starred: 'Đã gắn sao', trash: 'Thùng rác', storage: 'Dung lượng', storageCaption: 'Tệp đang được lưu trên Telegram',
      settings: 'Cài đặt kết nối', toggleTheme: 'Đổi giao diện', searchPlaceholder: 'Tìm kiếm trong Drive', newFolder: 'Thư mục mới', viewMode: 'Chế độ xem', dropTitle: 'Thả tệp để tải lên',
      dropDescription: 'Tệp sẽ được chia nhỏ và lưu riêng tư trên Telegram.', name: 'Tên', modified: 'Đã sửa đổi', size: 'Kích thước', emptyTitle: 'Thư mục này đang trống', emptyDescription: 'Kéo tệp vào đây hoặc chọn tải tệp lên để bắt đầu.',
      uploads: 'Đang tải lên', welcome: 'Chào mừng trở lại', loginIntro: 'Nhập mật khẩu để mở không gian tệp riêng tư của bạn.', password: 'Mật khẩu truy cập', passwordPlaceholder: 'Nhập mật khẩu', signIn: 'Đăng nhập', loginNote: 'Mật khẩu không được lưu trong trình duyệt.',
      cancel: 'Hủy', save: 'Lưu thay đổi', root: 'Tệp của tôi', folder: 'Thư mục', file: 'Tệp', download: 'Tải xuống', preview: 'Xem trước', rename: 'Đổi tên', removeStar: 'Bỏ gắn sao', addStar: 'Gắn sao', moveToTrash: 'Chuyển vào thùng rác', restore: 'Khôi phục', deleteForever: 'Xóa vĩnh viễn',
      newFolderTitle: 'Thư mục mới', newFolderLabel: 'Tên thư mục', newFolderHelp: 'Thư mục sẽ được tạo tại vị trí hiện tại.', renameTitle: 'Đổi tên', renameLabel: 'Tên mới', saveName: 'Lưu tên', uploading: 'Đang tải lên', preparing: 'Đang chuẩn bị', uploadingPart: 'Đang tải phần {current}/{total}', waitingRetry: 'Lỗi mạng, thử lại sau {seconds}s ({attempt}/{max})', waitingFlood: 'Telegram giới hạn tốc độ, đợi {seconds}s...', completed: 'Hoàn tất', uploadSuccess: 'Đã tải “{name}” lên thành công.',
      folderCreated: 'Đã tạo thư mục “{name}”.', renamed: 'Đã đổi tên.', movedToTrash: 'Đã chuyển vào thùng rác.', restored: 'Đã khôi phục.', deleted: 'Đã xóa vĩnh viễn.', downloaded: 'Đang chuẩn bị tệp tải xuống…', loadingPreview: 'Đang tải xem trước…', previewFailed: 'Không thể xem trước tệp này.', wrongPassword: 'Mật khẩu không đúng hoặc phiên đã hết hạn.', networkError: 'Không thể kết nối đến máy chủ. Hãy kiểm tra mạng của bạn.', confirmDelete: 'Xóa vĩnh viễn “{name}”? Hành động này không thể hoàn tác.', confirmSignOut: 'Bạn có muốn đăng xuất khỏi Telegram Drive?', noSearch: 'Không tìm thấy tệp phù hợp', noSearchDesc: 'Hãy thử từ khóa khác hoặc quay lại thư mục của bạn.', loadError: 'Không thể tải danh sách tệp.', uploadingToRoot: 'Bạn đang ở mục đặc biệt; tệp sẽ được tải lên thư mục gốc.', signOut: 'Đăng xuất', requestFailed: 'Thao tác không thành công.'
    },
    en: {
      upload: 'Upload files', myFiles: 'My files', recent: 'Recent', starred: 'Starred', trash: 'Trash', storage: 'Storage', storageCaption: 'Files are privately stored on Telegram', settings: 'Connection settings', toggleTheme: 'Toggle theme', searchPlaceholder: 'Search in Drive', newFolder: 'New folder', viewMode: 'View mode', dropTitle: 'Drop files to upload', dropDescription: 'Files are chunked and privately stored on Telegram.', name: 'Name', modified: 'Last modified', size: 'Size', emptyTitle: 'This folder is empty', emptyDescription: 'Drop files here or choose Upload files to get started.', uploads: 'Uploads', welcome: 'Welcome back', loginIntro: 'Enter your password to access your private file space.', password: 'Access password', passwordPlaceholder: 'Enter password', signIn: 'Sign in', loginNote: 'Your password is never stored in this browser.',
      cancel: 'Cancel', save: 'Save changes', root: 'My files', folder: 'Folder', file: 'File', download: 'Download', preview: 'Preview', rename: 'Rename', removeStar: 'Remove star', addStar: 'Add star', moveToTrash: 'Move to trash', restore: 'Restore', deleteForever: 'Delete forever', newFolderTitle: 'New folder', newFolderLabel: 'Folder name', newFolderHelp: 'The folder will be created in the current location.', renameTitle: 'Rename', renameLabel: 'New name', saveName: 'Save name', uploading: 'Uploading', preparing: 'Preparing', uploadingPart: 'Uploading part {current}/{total}', waitingRetry: 'Network error, retrying in {seconds}s ({attempt}/{max})', waitingFlood: 'Telegram rate limit hit, waiting {seconds}s...', completed: 'Completed', uploadSuccess: '“{name}” uploaded successfully.', folderCreated: 'Folder “{name}” created.', renamed: 'Name updated.', movedToTrash: 'Moved to trash.', restored: 'Restored.', deleted: 'Permanently deleted.', downloaded: 'Preparing your download…', loadingPreview: 'Loading preview…', previewFailed: 'This file could not be previewed.', wrongPassword: 'Incorrect password or expired session.', networkError: 'Could not reach the server. Check your connection.', confirmDelete: 'Permanently delete “{name}”? This cannot be undone.', confirmSignOut: 'Sign out of Telegram Drive?', noSearch: 'No matching files', noSearchDesc: 'Try another keyword or return to your files.', loadError: 'Unable to load files.', uploadingToRoot: 'You are in a special view; files will upload to the root folder.', signOut: 'Sign out', requestFailed: 'The action could not be completed.'
    }
  };

  const state = {
    token: sessionStorage.getItem(KEYS.token) || '',
    lang: localStorage.getItem(KEYS.lang) || (navigator.language.startsWith('vi') ? 'vi' : 'en'),
    theme: localStorage.getItem(KEYS.theme) || 'light',
    view: localStorage.getItem(KEYS.view) || 'grid',
    scope: 'files', parentId: null, breadcrumbs: [], items: [], stats: { bytes: 0, count: 0 }, query: '', promptHandler: null, isLoading: false, uploadingCount: 0
  };

  function t(key, values = {}) { return (COPY[state.lang][key] || COPY.vi[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ''); }
  function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function formatBytes(bytes = 0) { if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), units.length - 1); return `${(Number(bytes) / 1024 ** index).toFixed(index ? (Number(bytes) / 1024 ** index >= 10 ? 0 : 1) : 0)} ${units[index]}`; }
  function formatDate(date) { try { return new Intl.DateTimeFormat(state.lang === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date)); } catch { return '—'; } }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token && options.auth !== false) headers.set('X-Drive-Token', state.token);
    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;
    if (!response.ok || payload?.ok === false) {
      const message = payload?.error || `HTTP ${response.status}`; const err = new Error(message); err.status = response.status; throw err;
    }
    return payload ?? response;
  }

  async function loadFiles() {
    if (!state.token || state.isLoading) return;
    state.isLoading = true;
    const params = new URLSearchParams({ scope: state.scope });
    if (state.scope === 'files' && state.parentId) params.set('parentId', state.parentId);
    if (state.query) params.set('q', state.query);
    try {
      const data = await api(`/files?${params}`);
      state.items = Array.isArray(data.items) ? data.items : [];
      state.breadcrumbs = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];
      state.stats = data.stats || state.stats;
      render();
    } catch (error) {
      if (error.status === 401) { handleExpiredSession(); return; }
      state.items = []; render(); toast(t('loadError'), 'error');
    } finally { state.isLoading = false; }
  }

  function render() { applyTranslations(); renderNavigation(); renderBreadcrumbs(); renderFiles(); renderStorage(); }
  function applyTranslations() {
    document.documentElement.lang = state.lang;
    document.title = 'Telegram Drive';
    $$('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    $$('[data-i18n-title]').forEach(node => { node.title = t(node.dataset.i18nTitle); });
    const languageButton = $('#languageButton'); if (languageButton) languageButton.textContent = state.lang === 'vi' ? 'EN' : 'VI';
    const themeButton = $('#themeButton'); if (themeButton) themeButton.replaceChildren(icon(state.theme === 'dark' ? 'sun' : 'moon'));
    document.body.classList.toggle('dark', state.theme === 'dark');
  }
  function renderNavigation() {
    $$('.nav-item').forEach(button => button.classList.toggle('is-active', button.dataset.scope === state.scope));
    const title = state.query ? `${t('myFiles')} · ${state.query}` : t(state.scope === 'files' ? 'myFiles' : state.scope);
    $('#pageTitle').textContent = title;
    $('#scopeLabel').textContent = state.query ? t('searchPlaceholder').toUpperCase() : state.scope === 'files' ? 'TELEGRAM DRIVE' : t(state.scope).toUpperCase();
    $('#newFolderButton').hidden = state.scope !== 'files';
  }
  function renderStorage() {
    $('#storageSize').textContent = formatBytes(state.stats.bytes);
    $('#storageCaption').textContent = state.stats.count ? `${state.stats.count} ${state.stats.count === 1 ? t('file').toLowerCase() : t('myFiles').toLowerCase()}` : t('storageCaption');
    $('#storageBar').style.width = `${Math.max(7, Math.min(100, Math.log10(Number(state.stats.bytes || 1) + 10) * 10))}%`;
  }
  function renderBreadcrumbs() {
    const container = $('#breadcrumbs'); container.replaceChildren();
    if (state.scope !== 'files') { container.append(el('span', 'crumb', t(state.scope))); return; }
    const crumbs = [{ id: null, name: t('root') }, ...state.breadcrumbs];
    crumbs.forEach((crumb, index) => {
      if (index) { const separator = icon('chevron'); separator.classList.add('crumb-separator'); container.append(separator); }
      const button = el('button', 'crumb', crumb.name); button.type = 'button'; button.disabled = index === crumbs.length - 1; button.prepend(icon(index ? 'folder' : 'drive'));
      button.addEventListener('click', () => { state.parentId = crumb.id; loadFiles(); }); container.append(button);
    });
  }
  function fileType(item) {
    if (item.type === 'folder') return ['folder', 'folder'];
    const mime = item.mime || ''; if (mime.startsWith('image/')) return ['image', 'image']; if (mime.startsWith('video/') || mime.startsWith('audio/')) return ['video', 'film']; if (/pdf|word|sheet|presentation|text|json|zip/.test(mime)) return ['document', 'doc']; return ['generic', 'file'];
  }
  function renderFiles() {
    const list = $('#fileList'); list.className = `file-grid${state.view === 'list' ? ' is-list' : ''}`; list.replaceChildren();
    const empty = $('#emptyState'); const hasItems = state.items.length > 0;
    empty.hidden = hasItems;
    if (!hasItems) {
      const searching = Boolean(state.query); $('#emptyTitle').textContent = searching ? t('noSearch') : t('emptyTitle'); $('#emptyDescription').textContent = searching ? t('noSearchDesc') : t('emptyDescription');
      $('#emptyUploadButton').hidden = searching || state.scope === 'trash'; return;
    }
    state.items.forEach(item => list.append(createFileCard(item)));
  }
  function createFileCard(item) {
    const card = el('article', 'file-card'); card.dataset.id = item.id; const [kind, symbol] = fileType(item);
    const primary = el('button', 'file-card-main'); primary.type = 'button'; primary.title = item.name; const visual = el('span', `file-icon ${kind}`); visual.append(icon(symbol)); const name = el('span', 'file-name', item.name); const meta = el('span', 'file-meta', item.type === 'folder' ? t('folder') : formatBytes(item.size)); const date = el('span', 'list-date', formatDate(item.updatedAt || item.createdAt)); const size = el('span', 'list-size', item.type === 'folder' ? '—' : formatBytes(item.size));
    primary.append(visual, name, meta); primary.addEventListener('click', () => openItem(item)); card.append(primary, date, size);
    if (state.scope !== 'trash') { const star = el('button', `file-star${item.starred ? '' : ' is-empty'}`); star.type = 'button'; star.title = item.starred ? t('removeStar') : t('addStar'); star.append(icon('star')); star.addEventListener('click', event => { event.stopPropagation(); mutateItem(item, 'star', { starred: !item.starred }); }); card.append(star); }
    const menu = el('div', 'file-menu'); const trigger = el('button', 'icon-button menu-trigger'); trigger.type = 'button'; trigger.setAttribute('aria-label', 'File actions'); trigger.append(icon('more')); const popover = el('div', 'menu-popover');
    trigger.addEventListener('click', event => { event.stopPropagation(); $$('.file-menu.is-open').forEach(node => node.classList.remove('is-open')); menu.classList.toggle('is-open'); }); menu.append(trigger, popover);
    if (state.scope === 'trash') { addMenuButton(popover, 'restore', t('restore'), () => mutateItem(item, 'restore')); addMenuButton(popover, 'trash', t('deleteForever'), () => permanentlyDelete(item), true); }
    else {
      if (item.type === 'file') {
        if (previewKind(item)) addMenuButton(popover, 'file', t('preview'), () => openPreview(item));
        addMenuButton(popover, 'download', t('download'), () => downloadItem(item));
      }
      addMenuButton(popover, 'rename', t('rename'), () => openRename(item)); addMenuButton(popover, 'star', item.starred ? t('removeStar') : t('addStar'), () => mutateItem(item, 'star', { starred: !item.starred })); addMenuButton(popover, 'trash', t('moveToTrash'), () => mutateItem(item, 'trash'), true);
    }
    card.append(menu); return card;
  }
  function addMenuButton(parent, symbol, label, onClick, danger = false) { const button = el('button', danger ? 'danger' : ''); button.type = 'button'; button.append(icon(symbol), document.createTextNode(label)); button.addEventListener('click', event => { event.stopPropagation(); parent.closest('.file-menu').classList.remove('is-open'); onClick(); }); parent.append(button); }
  function openFolder(item) { state.scope = 'files'; state.parentId = item.id; state.query = ''; $('#searchInput').value = ''; loadFiles(); }
  function openItem(item) { if (item.type === 'folder') openFolder(item); else if (previewKind(item)) openPreview(item); else downloadItem(item); }

  async function createFolder(name) { try { await api('/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId: state.parentId }) }); toast(t('folderCreated', { name }), 'success'); await loadFiles(); } catch (error) { notifyError(error); } }
  async function mutateItem(item, operation, details = {}) { try { await api(`/files/${encodeURIComponent(item.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...details }) }); toast(operation === 'trash' ? t('movedToTrash') : operation === 'restore' ? t('restored') : t('renamed'), 'success'); await loadFiles(); } catch (error) { notifyError(error); } }
  async function permanentlyDelete(item) { if (!window.confirm(t('confirmDelete', { name: item.name }))) return; try { await api(`/files/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); toast(t('deleted'), 'success'); await loadFiles(); } catch (error) { notifyError(error); } }
  function openNewFolder() { openPrompt({ title: t('newFolderTitle'), label: t('newFolderLabel'), help: t('newFolderHelp'), submit: t('save'), value: '', onSubmit: createFolder }); }
  function openRename(item) { openPrompt({ title: t('renameTitle'), label: t('renameLabel'), help: '', submit: t('saveName'), value: item.name, onSubmit: name => mutateItem(item, 'rename', { name }) }); }
  function openPrompt({ title, label, help, submit, value, onSubmit }) { $('#promptTitle').textContent = title; $('#promptLabel').textContent = label; $('#promptHelp').textContent = help; $('#promptSubmit').textContent = submit; $('#promptInput').value = value; state.promptHandler = onSubmit; openModal('promptModal'); setTimeout(() => $('#promptInput').select(), 0); }

  async function fetchItemBlob(item) {
    const response = await fetch(`${API_URL}/files/${encodeURIComponent(item.id)}/content`, { headers: { 'X-Drive-Token': state.token } });
    if (!response.ok) { const data = await response.json().catch(() => ({})); const err = new Error(data.error || `HTTP ${response.status}`); err.status = response.status; throw err; }
    return response.blob();
  }
  async function downloadItem(item) {
    toast(t('downloaded'), 'info');
    try {
      const blob = await fetchItemBlob(item); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } catch (error) { notifyError(error); }
  }

  async function handleFiles(files) {
    const entries = [...files].filter(file => file.size > 0); if (!entries.length) return;
    if (state.scope !== 'files') { state.scope = 'files'; state.parentId = null; toast(t('uploadingToRoot'), 'info'); }
    $('#uploadTray').hidden = false;
    for (const file of entries) await uploadFile(file);
    await loadFiles();
  }
async function uploadFile(file) {
    state.uploadingCount += 1;
    const row = createUploadRow(file);
    const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const parts = new Array(total);
    const chunkProgress = new Array(total).fill(0);
    const CONCURRENCY = 2; // Tải 2 luồng song song

    const updateProgress = () => {
      const sumProgress = chunkProgress.reduce((acc, p) => acc + p, 0);
      const overallPercent = Math.round(sumProgress / total);
      const completedCount = chunkProgress.filter(p => p === 100).length;
      setUploadProgress(row, overallPercent, t('uploadingPart', { current: Math.min(completedCount + 1, total), total }));
    };

    try {
      for (let i = 0; i < total; i += CONCURRENCY) {
        const batch = [];
        for (let j = 0; j < CONCURRENCY && (i + j) < total; j += 1) {
          const index = i + j;
          const slice = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
          const filename = `${file.name}.part-${String(index + 1).padStart(4, '0')}`;

          const task = (async () => {
            const part = await uploadChunkWithRetry(slice, filename, percent => {
              chunkProgress[index] = percent;
              updateProgress();
            });
            chunkProgress[index] = 100;
            updateProgress();
            parts[index] = {
              fileId: part.telegram_file_id,
              messageId: part.telegram_message_id,
              size: part.size || slice.size,
              index
            };
          })();
          batch.push(task);
        }

        // Đợi 2 luồng trong đợt này hoàn thành
        await Promise.all(batch);

        // Nghỉ giữa các đợt để tránh bị Telegram dính 429 Rate Limit
        if (i + CONCURRENCY < total) await sleep(INTER_CHUNK_DELAY_MS);
      }

      await api('/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          parentId: state.parentId,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          parts: parts.filter(Boolean)
        })
      });

      setUploadProgress(row, 100, t('completed'));
      row.classList.add('completed');
      toast(t('uploadSuccess', { name: file.name }), 'success');
    } catch (error) {
      row.classList.add('error');
      setUploadProgress(row, 100, error.message || t('requestFailed'));
      await cleanupUploadedParts(parts.filter(Boolean));
      notifyError(error);
    } finally {
      state.uploadingCount -= 1;
    }
  }
  function createUploadRow(file) { const row = el('div', 'upload-row'); const name = el('span', 'upload-name', file.name); const status = el('div', 'upload-status'); const label = el('span', '', t('preparing')); const percentage = el('span', 'upload-percent', '0%'); status.append(label, percentage); const track = el('div', 'progress-track'); const fill = document.createElement('i'); track.append(fill); row.append(name, status, track); $('#uploadQueue').prepend(row); return row; }
  function setUploadProgress(row, value, label) { $('.progress-track i', row).style.width = `${Math.min(100, Math.max(0, value))}%`; $('.upload-percent', row).textContent = `${Math.round(value)}%`; $('.upload-status span', row).textContent = label; }

  // ───────────────────────────────────────────────────────────────────────
  // Upload retry: exponential backoff 2s → 4s → 8s → 16s → 32s (5 attempts).
  // A Telegram flood-control response (HTTP 429, surfaced by the Worker as
  // status 429) gets its own toast wording but follows the same backoff.
  // ───────────────────────────────────────────────────────────────────────
  async function uploadChunkWithRetry(blob, filename, onProgress) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt += 1) {
      try {
        return await uploadChunkOnce(blob, filename, onProgress);
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRY) {
          const seconds = Math.round(RETRY_BASE_MS * 2 ** attempt / 1000);
          toast(t(error.status === 429 ? 'waitingFlood' : 'waitingRetry', { seconds, attempt: attempt + 1, max: MAX_RETRY }), 'info');
          await sleep(seconds * 1000);
        }
      }
    }
    throw lastError;
  }
  function uploadChunkOnce(blob, filename, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); const form = new FormData(); form.append('file', blob, filename); form.append('filename', filename);
      xhr.open('POST', `${API_URL}/upload`); xhr.setRequestHeader('X-Drive-Token', state.token);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total * 100); };
      xhr.onerror = () => reject(new Error(t('networkError')));
      xhr.onload = () => {
        let data = {}; try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data);
        else { const error = new Error(data.error || t('requestFailed')); error.status = xhr.status; reject(error); }
      };
      xhr.send(form);
    });
  }
  async function cleanupUploadedParts(parts) { await Promise.allSettled(parts.map(part => api('/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: part.messageId }) }))); }

  // ───────────────────────────────────────────────────────────────────────
  // 4) Rich preview modal — built entirely in JS so no index.html edit is
  //    required. Supports images, video, audio, and text/code files.
  // ───────────────────────────────────────────────────────────────────────
  const PREVIEW_EXTENSIONS = {
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'],
    video: ['mp4', 'webm', 'mkv'],
    audio: ['mp3', 'wav', 'ogg', 'flac'],
    text: ['txt', 'json', 'js', 'py', 'cpp', 'html', 'css', 'md', 'log']
  };
  function fileExtension(name) { const match = /\.([a-z0-9]+)$/i.exec(name || ''); return match ? match[1].toLowerCase() : ''; }
  function previewKind(item) {
    if (!item || item.type !== 'file') return null;
    const mime = item.mime || ''; const ext = fileExtension(item.name);
    if (mime.startsWith('image/') || PREVIEW_EXTENSIONS.image.includes(ext)) return 'image';
    if (mime.startsWith('video/') || PREVIEW_EXTENSIONS.video.includes(ext)) return 'video';
    if (mime.startsWith('audio/') || PREVIEW_EXTENSIONS.audio.includes(ext)) return 'audio';
    if (mime.startsWith('text/') || PREVIEW_EXTENSIONS.text.includes(ext)) return 'text';
    return null;
  }
  let previewModalEl = null; let previewObjectUrl = null;
  function buildPreviewModal() {
    const backdrop = el('div', 'modal-backdrop'); backdrop.id = 'previewModal'; backdrop.hidden = true;
    backdrop.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:1000;';
    const modal = el('div', 'modal'); modal.style.cssText = 'background:var(--surface,#fff);border-radius:14px;max-width:min(92vw,960px);max-height:88vh;width:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);';
    const header = el('div', 'modal-header'); header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(120,120,120,.2);gap:12px;';
    const title = el('h2', '', ''); title.id = 'previewTitle'; title.style.cssText = 'font-size:15px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const closeButton = el('button', 'icon-button'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close'); closeButton.append(icon('close'));
    closeButton.addEventListener('click', closePreview);
    header.append(title, closeButton);
    const body = el('div', 'modal-body'); body.id = 'previewBody'; body.style.cssText = 'padding:0;overflow:auto;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.03);min-height:200px;flex:1;';
    modal.append(header, body); backdrop.append(modal);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closePreview(); });
    document.body.append(backdrop);
    return backdrop;
  }
  function ensurePreviewModal() { if (!previewModalEl) previewModalEl = buildPreviewModal(); return previewModalEl; }
  function releasePreviewObjectUrl() { if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; } }
  function closePreview() {
    const modal = ensurePreviewModal(); modal.hidden = true;
    $('#previewBody', modal).replaceChildren(); releasePreviewObjectUrl();
  }
  async function openPreview(item) {
    const kind = previewKind(item); if (!kind) { downloadItem(item); return; }
    const modal = ensurePreviewModal(); const body = $('#previewBody', modal); const title = $('#previewTitle', modal);
    title.textContent = item.name; body.replaceChildren(el('p', '', t('loadingPreview'))); modal.hidden = false; releasePreviewObjectUrl();
    try {
      if (kind === 'text') {
        const blob = await fetchItemBlob(item); const text = await blob.text();
        const pre = el('pre'); pre.style.cssText = 'margin:0;padding:18px;max-height:78vh;overflow:auto;width:100%;box-sizing:border-box;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.5;';
        const code = el('code', '', text); pre.append(code); body.replaceChildren(pre);
        return;
      }
      const blob = await fetchItemBlob(item); previewObjectUrl = URL.createObjectURL(blob);
      let media;
      if (kind === 'image') { media = document.createElement('img'); media.alt = item.name; media.style.cssText = 'max-width:100%;max-height:78vh;display:block;object-fit:contain;'; }
      else if (kind === 'video') { media = document.createElement('video'); media.controls = true; media.autoplay = false; media.style.cssText = 'max-width:100%;max-height:78vh;display:block;background:#000;'; }
      else { media = document.createElement('audio'); media.controls = true; media.style.cssText = 'width:100%;padding:32px;'; }
      media.src = previewObjectUrl; body.replaceChildren(media);
    } catch (error) {
      body.replaceChildren(el('p', '', error.status === 401 ? t('wrongPassword') : t('previewFailed')));
      if (error.status === 401) handleExpiredSession();
    }
  }

  function toast(message, type = 'info') { const entry = el('div', `toast ${type}`); entry.append(icon(type === 'success' ? 'drive' : type === 'error' ? 'close' : 'files'), el('p', '', message)); $('#toastStack').append(entry); setTimeout(() => { entry.style.opacity = '0'; entry.style.transform = 'translateY(-8px)'; setTimeout(() => entry.remove(), 220); }, 4_200); }
  function notifyError(error) { if (error.status === 401) { handleExpiredSession(); return; } toast(error.message === 'Failed to fetch' ? t('networkError') : error.message || t('requestFailed'), 'error'); }
  function openModal(id) { $(`#${id}`).hidden = false; } function closeModal(id) { $(`#${id}`).hidden = true; }
  function showLogin() { const passwordField = $('#password'); if (passwordField) passwordField.value = ''; $('#loginModal').hidden = false; passwordField?.focus(); }
  function handleExpiredSession() { sessionStorage.removeItem(KEYS.token); state.token = ''; showLogin(); toast(t('wrongPassword'), 'error'); }
  function signOut() { if (!window.confirm(t('confirmSignOut'))) return; sessionStorage.removeItem(KEYS.token); state.token = ''; showLogin(); }

  // ───────────────────────────────────────────────────────────────────────
  // 2) Fully hides any Worker-URL configuration surface left over in
  //    index.html (login URL field, Settings button/modal) — the app now
  //    only asks for the password, never a Worker address.
  // ───────────────────────────────────────────────────────────────────────
  function hideWorkerUrlConfig() {
    const apiUrlField = $('#apiUrl'); if (apiUrlField) { const label = apiUrlField.closest('label') || apiUrlField.previousElementSibling; if (label && label.tagName === 'LABEL') label.hidden = true; apiUrlField.hidden = true; apiUrlField.removeAttribute('required'); }
    $('#settingsButton')?.setAttribute('hidden', 'hidden');
    $('#settingsModal')?.setAttribute('hidden', 'hidden');
  }

  function bindEvents() {
    $('#loginForm').addEventListener('submit', async event => {
      event.preventDefault(); const password = $('#password').value; const button = $('#loginButton'); button.disabled = true;
      try {
        const response = await fetch(`${API_URL}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) { const error = new Error(data.error || t('wrongPassword')); error.status = response.status; throw error; }
        state.token = data.token; sessionStorage.setItem(KEYS.token, data.token); $('#loginModal').hidden = true; await loadFiles();
      } catch (error) { toast(error.status === 401 ? t('wrongPassword') : (error.message === 'Failed to fetch' ? t('networkError') : error.message), 'error'); }
      finally { button.disabled = false; }
    });
    $('#passwordToggle')?.addEventListener('click', () => { const field = $('#password'); field.type = field.type === 'password' ? 'text' : 'password'; });
    $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
    $('#promptForm').addEventListener('submit', event => { event.preventDefault(); const name = $('#promptInput').value.trim(); if (!name) return; const action = state.promptHandler; closeModal('promptModal'); state.promptHandler = null; action?.(name); });
    $$('.nav-item').forEach(button => button.addEventListener('click', () => { state.scope = button.dataset.scope; state.parentId = null; state.query = ''; $('#searchInput').value = ''; loadFiles(); }));
    $('#uploadButton').addEventListener('click', () => $('#fileInput').click()); $('#uploadButtonMobile')?.addEventListener('click', () => $('#fileInput').click()); $('#emptyUploadButton').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; }); $('#newFolderButton').addEventListener('click', openNewFolder); $('#closeUploadTray').addEventListener('click', () => { $('#uploadTray').hidden = true; });
    $$('.view-switcher [data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; localStorage.setItem(KEYS.view, state.view); $$('.view-switcher [data-view]').forEach(node => node.classList.toggle('is-active', node === button)); renderFiles(); }));
    let searchTimer; $('#searchInput').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value.trim(); loadFiles(); }, 260); });
    $('#languageButton')?.addEventListener('click', () => { state.lang = state.lang === 'vi' ? 'en' : 'vi'; localStorage.setItem(KEYS.lang, state.lang); render(); }); $('#themeButton')?.addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem(KEYS.theme, state.theme); applyTranslations(); }); $('#accountButton')?.addEventListener('click', signOut);
    const fileArea = $('#fileArea'); ['dragenter', 'dragover'].forEach(type => fileArea.addEventListener(type, event => { event.preventDefault(); fileArea.classList.add('is-dragging'); })); ['dragleave', 'drop'].forEach(type => fileArea.addEventListener(type, event => { event.preventDefault(); fileArea.classList.remove('is-dragging'); })); fileArea.addEventListener('drop', event => { if (event.dataTransfer?.files) handleFiles(event.dataTransfer.files); });
    $('#mobileMenu')?.addEventListener('click', () => $('.sidebar').classList.toggle('is-open')); document.addEventListener('click', () => $$('.file-menu.is-open').forEach(menu => menu.classList.remove('is-open')));
    document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } if (event.key === 'Escape') { $$('.file-menu.is-open').forEach(menu => menu.classList.remove('is-open')); closeModal('promptModal'); closePreview(); } });
    window.addEventListener('beforeunload', event => { if (state.uploadingCount > 0) { event.preventDefault(); event.returnValue = ''; } });
  }

  function initialise() {
    hideWorkerUrlConfig();
    ensurePreviewModal();
    bindEvents(); applyTranslations();
    $$('.view-switcher [data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === state.view));
    if (state.token) loadFiles(); else showLogin();
  }
  initialise();
})();
