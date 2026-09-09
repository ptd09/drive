/* Telegram Drive frontend — no framework or build step required. */
(() => {
  'use strict';

  const CHUNK_SIZE = 18 * 1024 * 1024; // Kept below Telegram Bot API's 20 MB getFile download ceiling.
  // Keep the previous deployment working out of the box. Forks can override it
  // before this file loads with window.TELEGRAM_DRIVE_API_URL, or in Settings.
  const APP_CONFIG_URL = window.TELEGRAM_DRIVE_API_URL || 'https://drive-worker.phamdatt140613.workers.dev';
  const KEYS = { api: 'telegramDrive.apiUrl', lang: 'telegramDrive.lang', theme: 'telegramDrive.theme', view: 'telegramDrive.view', token: 'telegramDrive.session' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const COPY = {
    vi: {
      upload: 'Tải tệp lên', myFiles: 'Tệp của tôi', recent: 'Gần đây', starred: 'Đã gắn sao', trash: 'Thùng rác', storage: 'Dung lượng', storageCaption: 'Tệp đang được lưu trên Telegram',
      settings: 'Cài đặt kết nối', toggleTheme: 'Đổi giao diện', searchPlaceholder: 'Tìm kiếm trong Drive', newFolder: 'Thư mục mới', viewMode: 'Chế độ xem', dropTitle: 'Thả tệp để tải lên',
      dropDescription: 'Tệp sẽ được chia nhỏ và lưu riêng tư trên Telegram.', name: 'Tên', modified: 'Đã sửa đổi', size: 'Kích thước', emptyTitle: 'Thư mục này đang trống', emptyDescription: 'Kéo tệp vào đây hoặc chọn tải tệp lên để bắt đầu.',
      uploads: 'Đang tải lên', welcome: 'Chào mừng trở lại', loginIntro: 'Đăng nhập để mở không gian tệp riêng tư của bạn.', apiUrl: 'Địa chỉ Cloudflare Worker', password: 'Mật khẩu truy cập', passwordPlaceholder: 'Nhập mật khẩu', signIn: 'Đăng nhập', loginNote: 'Kết nối được mã hóa và mật khẩu không được lưu trong trình duyệt.',
      connection: 'Kết nối Worker', settingsHelp: 'Đổi địa chỉ sẽ đăng xuất phiên hiện tại.', cancel: 'Hủy', save: 'Lưu thay đổi', root: 'Tệp của tôi', folder: 'Thư mục', file: 'Tệp', download: 'Tải xuống', rename: 'Đổi tên', removeStar: 'Bỏ gắn sao', addStar: 'Gắn sao', moveToTrash: 'Chuyển vào thùng rác', restore: 'Khôi phục', deleteForever: 'Xóa vĩnh viễn',
      newFolderTitle: 'Thư mục mới', newFolderLabel: 'Tên thư mục', newFolderHelp: 'Thư mục sẽ được tạo tại vị trí hiện tại.', renameTitle: 'Đổi tên', renameLabel: 'Tên mới', saveName: 'Lưu tên', uploading: 'Đang tải lên', preparing: 'Đang chuẩn bị', uploadingPart: 'Đang tải phần {current}/{total}', completed: 'Hoàn tất', uploadSuccess: 'Đã tải “{name}” lên thành công.',
      folderCreated: 'Đã tạo thư mục “{name}”.', renamed: 'Đã đổi tên.', movedToTrash: 'Đã chuyển vào thùng rác.', restored: 'Đã khôi phục.', deleted: 'Đã xóa vĩnh viễn.', downloaded: 'Đang chuẩn bị tệp tải xuống…', wrongPassword: 'Mật khẩu không đúng hoặc phiên đã hết hạn.', networkError: 'Không thể kết nối đến Worker. Hãy kiểm tra URL và mạng.', invalidApi: 'Vui lòng nhập URL Worker hợp lệ.', confirmDelete: 'Xóa vĩnh viễn “{name}”? Hành động này không thể hoàn tác.', confirmSignOut: 'Bạn có muốn đăng xuất khỏi Telegram Drive?', noSearch: 'Không tìm thấy tệp phù hợp', noSearchDesc: 'Hãy thử từ khóa khác hoặc quay lại thư mục của bạn.', loadError: 'Không thể tải danh sách tệp.', unsupportedPreview: 'Tệp đã sẵn sàng để tải xuống.', uploadingToRoot: 'Bạn đang ở mục đặc biệt; tệp sẽ được tải lên thư mục gốc.', signOut: 'Đăng xuất', requestFailed: 'Thao tác không thành công.'
    },
    en: {
      upload: 'Upload files', myFiles: 'My files', recent: 'Recent', starred: 'Starred', trash: 'Trash', storage: 'Storage', storageCaption: 'Files are privately stored on Telegram', settings: 'Connection settings', toggleTheme: 'Toggle theme', searchPlaceholder: 'Search in Drive', newFolder: 'New folder', viewMode: 'View mode', dropTitle: 'Drop files to upload', dropDescription: 'Files are chunked and privately stored on Telegram.', name: 'Name', modified: 'Last modified', size: 'Size', emptyTitle: 'This folder is empty', emptyDescription: 'Drop files here or choose Upload files to get started.', uploads: 'Uploads', welcome: 'Welcome back', loginIntro: 'Sign in to access your private file space.', apiUrl: 'Cloudflare Worker URL', password: 'Access password', passwordPlaceholder: 'Enter password', signIn: 'Sign in', loginNote: 'The connection is encrypted and your password is never stored in this browser.', connection: 'Worker connection', settingsHelp: 'Changing this URL signs out the current session.', cancel: 'Cancel', save: 'Save changes', root: 'My files', folder: 'Folder', file: 'File', download: 'Download', rename: 'Rename', removeStar: 'Remove star', addStar: 'Add star', moveToTrash: 'Move to trash', restore: 'Restore', deleteForever: 'Delete forever', newFolderTitle: 'New folder', newFolderLabel: 'Folder name', newFolderHelp: 'The folder will be created in the current location.', renameTitle: 'Rename', renameLabel: 'New name', saveName: 'Save name', uploading: 'Uploading', preparing: 'Preparing', uploadingPart: 'Uploading part {current}/{total}', completed: 'Completed', uploadSuccess: '“{name}” uploaded successfully.', folderCreated: 'Folder “{name}” created.', renamed: 'Name updated.', movedToTrash: 'Moved to trash.', restored: 'Restored.', deleted: 'Permanently deleted.', downloaded: 'Preparing your download…', wrongPassword: 'Incorrect password or expired session.', networkError: 'Could not reach the Worker. Check its URL and your connection.', invalidApi: 'Enter a valid Worker URL.', confirmDelete: 'Permanently delete “{name}”? This cannot be undone.', confirmSignOut: 'Sign out of Telegram Drive?', noSearch: 'No matching files', noSearchDesc: 'Try another keyword or return to your files.', loadError: 'Unable to load files.', unsupportedPreview: 'The file is ready to download.', uploadingToRoot: 'You are in a special view; files will upload to the root folder.', signOut: 'Sign out', requestFailed: 'The action could not be completed.'
    }
  };

  const state = {
    apiUrl: normaliseUrl(window.TELEGRAM_DRIVE_API_URL || localStorage.getItem(KEYS.api) || APP_CONFIG_URL),
    token: sessionStorage.getItem(KEYS.token) || '',
    lang: localStorage.getItem(KEYS.lang) || (navigator.language.startsWith('vi') ? 'vi' : 'en'),
    theme: localStorage.getItem(KEYS.theme) || 'light',
    view: localStorage.getItem(KEYS.view) || 'grid',
    scope: 'files', parentId: null, breadcrumbs: [], items: [], stats: { bytes: 0, count: 0 }, query: '', promptHandler: null, isLoading: false, uploadingCount: 0
  };

  function normaliseUrl(value) { return String(value || '').trim().replace(/\/+$/, ''); }
  function t(key, values = {}) { return (COPY[state.lang][key] || COPY.vi[key] || key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ''); }
  function icon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg; }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function formatBytes(bytes = 0) { if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), units.length - 1); return `${(Number(bytes) / 1024 ** index).toFixed(index ? (Number(bytes) / 1024 ** index >= 10 ? 0 : 1) : 0)} ${units[index]}`; }
  function formatDate(date) { try { return new Intl.DateTimeFormat(state.lang === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date)); } catch { return '—'; } }
  function isValidHttpUrl(value) { try { const url = new URL(value); return /^https?:$/.test(url.protocol); } catch { return false; } }

  async function api(path, options = {}) {
    if (!state.apiUrl) throw new Error('NO_API_URL');
    const headers = new Headers(options.headers || {});
    if (state.token && options.auth !== false) headers.set('X-Drive-Token', state.token);
    const response = await fetch(`${state.apiUrl}${path}`, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : null;
    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || `HTTP ${response.status}`); error.status = response.status; throw error;
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
      state.items = []; render(); toast(error.message === 'NO_API_URL' ? t('invalidApi') : t('loadError'), 'error');
    } finally { state.isLoading = false; }
  }

  function render() { applyTranslations(); renderNavigation(); renderBreadcrumbs(); renderFiles(); renderStorage(); }
  function applyTranslations() {
    document.documentElement.lang = state.lang;
    document.title = 'Telegram Drive';
    $$('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    $$('[data-i18n-title]').forEach(node => { node.title = t(node.dataset.i18nTitle); });
    $('#languageButton').textContent = state.lang === 'vi' ? 'EN' : 'VI';
    $('#themeButton').replaceChildren(icon(state.theme === 'dark' ? 'sun' : 'moon'));
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
    primary.append(visual, name, meta); primary.addEventListener('click', () => item.type === 'folder' ? openFolder(item) : downloadItem(item)); card.append(primary, date, size);
    if (state.scope !== 'trash') { const star = el('button', `file-star${item.starred ? '' : ' is-empty'}`); star.type = 'button'; star.title = item.starred ? t('removeStar') : t('addStar'); star.append(icon('star')); star.addEventListener('click', event => { event.stopPropagation(); mutateItem(item, 'star', { starred: !item.starred }); }); card.append(star); }
    const menu = el('div', 'file-menu'); const trigger = el('button', 'icon-button menu-trigger'); trigger.type = 'button'; trigger.setAttribute('aria-label', 'File actions'); trigger.append(icon('more')); const popover = el('div', 'menu-popover');
    trigger.addEventListener('click', event => { event.stopPropagation(); $$('.file-menu.is-open').forEach(node => node.classList.remove('is-open')); menu.classList.toggle('is-open'); }); menu.append(trigger, popover);
    if (state.scope === 'trash') { addMenuButton(popover, 'restore', t('restore'), () => mutateItem(item, 'restore')); addMenuButton(popover, 'trash', t('deleteForever'), () => permanentlyDelete(item), true); }
    else { if (item.type === 'file') addMenuButton(popover, 'download', t('download'), () => downloadItem(item)); addMenuButton(popover, 'rename', t('rename'), () => openRename(item)); addMenuButton(popover, 'star', item.starred ? t('removeStar') : t('addStar'), () => mutateItem(item, 'star', { starred: !item.starred })); addMenuButton(popover, 'trash', t('moveToTrash'), () => mutateItem(item, 'trash'), true); }
    card.append(menu); return card;
  }
  function addMenuButton(parent, symbol, label, onClick, danger = false) { const button = el('button', danger ? 'danger' : ''); button.type = 'button'; button.append(icon(symbol), document.createTextNode(label)); button.addEventListener('click', event => { event.stopPropagation(); parent.closest('.file-menu').classList.remove('is-open'); onClick(); }); parent.append(button); }
  function openFolder(item) { state.scope = 'files'; state.parentId = item.id; state.query = ''; $('#searchInput').value = ''; loadFiles(); }

  async function createFolder(name) { try { await api('/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parentId: state.parentId }) }); toast(t('folderCreated', { name }), 'success'); await loadFiles(); } catch (error) { notifyError(error); } }
  async function mutateItem(item, operation, details = {}) { try { await api(`/files/${encodeURIComponent(item.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, ...details }) }); toast(operation === 'trash' ? t('movedToTrash') : operation === 'restore' ? t('restored') : t('renamed'), 'success'); await loadFiles(); } catch (error) { notifyError(error); } }
  async function permanentlyDelete(item) { if (!window.confirm(t('confirmDelete', { name: item.name }))) return; try { await api(`/files/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); toast(t('deleted'), 'success'); await loadFiles(); } catch (error) { notifyError(error); } }
  function openNewFolder() { openPrompt({ title: t('newFolderTitle'), label: t('newFolderLabel'), help: t('newFolderHelp'), submit: t('save'), value: '', onSubmit: createFolder }); }
  function openRename(item) { openPrompt({ title: t('renameTitle'), label: t('renameLabel'), help: '', submit: t('saveName'), value: item.name, onSubmit: name => mutateItem(item, 'rename', { name }) }); }
  function openPrompt({ title, label, help, submit, value, onSubmit }) { $('#promptTitle').textContent = title; $('#promptLabel').textContent = label; $('#promptHelp').textContent = help; $('#promptSubmit').textContent = submit; $('#promptInput').value = value; state.promptHandler = onSubmit; openModal('promptModal'); setTimeout(() => $('#promptInput').select(), 0); }

  async function downloadItem(item) {
    toast(t('downloaded'), 'info');
    try {
      const response = await fetch(`${state.apiUrl}/files/${encodeURIComponent(item.id)}/content`, { headers: { 'X-Drive-Token': state.token } });
      if (!response.ok) { const data = await response.json().catch(() => ({})); const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = item.name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 5_000);
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
    state.uploadingCount += 1; const row = createUploadRow(file); const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE)); const parts = [];
    try {
      for (let index = 0; index < total; index += 1) {
        setUploadProgress(row, Math.round(index / total * 100), t('uploadingPart', { current: index + 1, total }));
        const slice = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE)); const part = await uploadChunkWithRetry(slice, `${file.name}.part-${String(index + 1).padStart(4, '0')}`, percent => setUploadProgress(row, Math.round((index + percent / 100) / total * 100), t('uploadingPart', { current: index + 1, total })));
        parts.push({ fileId: part.telegram_file_id, messageId: part.telegram_message_id, size: part.size || slice.size, index });
      }
      await api('/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, parentId: state.parentId, mime: file.type || 'application/octet-stream', size: file.size, parts }) });
      setUploadProgress(row, 100, t('completed')); row.classList.add('completed'); toast(t('uploadSuccess', { name: file.name }), 'success');
    } catch (error) {
      row.classList.add('error'); setUploadProgress(row, 100, error.message || t('requestFailed')); await cleanupUploadedParts(parts);
      notifyError(error);
    } finally { state.uploadingCount -= 1; }
  }
  function createUploadRow(file) { const row = el('div', 'upload-row'); const name = el('span', 'upload-name', file.name); const status = el('div', 'upload-status'); const label = el('span', '', t('preparing')); const percentage = el('span', 'upload-percent', '0%'); status.append(label, percentage); const track = el('div', 'progress-track'); const fill = document.createElement('i'); track.append(fill); row.append(name, status, track); $('#uploadQueue').prepend(row); return row; }
  function setUploadProgress(row, value, label) { $('.progress-track i', row).style.width = `${Math.min(100, Math.max(0, value))}%`; $('.upload-percent', row).textContent = `${Math.round(value)}%`; $('.upload-status span', row).textContent = label; }
  async function uploadChunkWithRetry(blob, filename, onProgress) { let lastError; for (let attempt = 0; attempt <= 5; attempt += 1) { try { return await uploadChunkOnce(blob, filename, onProgress); } catch (error) { lastError = error; if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** attempt)); } } throw lastError; }
  function uploadChunkOnce(blob, filename, onProgress) { return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); const form = new FormData(); form.append('file', blob, filename); form.append('filename', filename); xhr.open('POST', `${state.apiUrl}/upload`); xhr.setRequestHeader('X-Drive-Token', state.token); xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total * 100); }; xhr.onerror = () => reject(new Error(t('networkError'))); xhr.onload = () => { let data = {}; try { data = JSON.parse(xhr.responseText); } catch { /* handled below */ } if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data); else { const error = new Error(data.error || t('requestFailed')); error.status = xhr.status; reject(error); } }; xhr.send(form); }); }
  async function cleanupUploadedParts(parts) { await Promise.allSettled(parts.map(part => api('/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: part.messageId }) }))); }

  function toast(message, type = 'info') { const entry = el('div', `toast ${type}`); entry.append(icon(type === 'success' ? 'drive' : type === 'error' ? 'close' : 'files'), el('p', '', message)); $('#toastStack').append(entry); setTimeout(() => { entry.style.opacity = '0'; entry.style.transform = 'translateY(-8px)'; setTimeout(() => entry.remove(), 220); }, 4_200); }
  function notifyError(error) { if (error.status === 401) { handleExpiredSession(); return; } toast(error.message === 'NO_API_URL' || error.message === 'Failed to fetch' ? t('networkError') : error.message || t('requestFailed'), 'error'); }
  function openModal(id) { $(`#${id}`).hidden = false; } function closeModal(id) { $(`#${id}`).hidden = true; }
  function showLogin() { $('#apiUrl').value = state.apiUrl; $('#password').value = ''; $('#loginModal').hidden = false; $('#password').focus(); } function handleExpiredSession() { sessionStorage.removeItem(KEYS.token); state.token = ''; showLogin(); toast(t('wrongPassword'), 'error'); }
  function signOut() { if (!window.confirm(t('confirmSignOut'))) return; sessionStorage.removeItem(KEYS.token); state.token = ''; showLogin(); }

  function bindEvents() {
    $('#loginForm').addEventListener('submit', async event => { event.preventDefault(); const url = normaliseUrl($('#apiUrl').value); const password = $('#password').value; if (!isValidHttpUrl(url)) { toast(t('invalidApi'), 'error'); return; } const button = $('#loginButton'); button.disabled = true; try { const response = await fetch(`${url}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); const data = await response.json().catch(() => ({})); if (!response.ok || !data.token) { const error = new Error(data.error || t('wrongPassword')); error.status = response.status; throw error; } state.apiUrl = url; state.token = data.token; localStorage.setItem(KEYS.api, url); sessionStorage.setItem(KEYS.token, data.token); $('#loginModal').hidden = true; await loadFiles(); } catch (error) { toast(error.status === 401 ? t('wrongPassword') : (error.message === 'Failed to fetch' ? t('networkError') : error.message), 'error'); } finally { button.disabled = false; } });
    $('#passwordToggle').addEventListener('click', () => { const field = $('#password'); field.type = field.type === 'password' ? 'text' : 'password'; });
    $('#settingsButton').addEventListener('click', () => { $('#settingsApiUrl').value = state.apiUrl; openModal('settingsModal'); }); $('#settingsForm').addEventListener('submit', event => { event.preventDefault(); const url = normaliseUrl($('#settingsApiUrl').value); if (!isValidHttpUrl(url)) { toast(t('invalidApi'), 'error'); return; } if (url !== state.apiUrl) { state.apiUrl = url; localStorage.setItem(KEYS.api, url); sessionStorage.removeItem(KEYS.token); state.token = ''; closeModal('settingsModal'); showLogin(); } else closeModal('settingsModal'); });
    $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal))); $('#promptForm').addEventListener('submit', event => { event.preventDefault(); const name = $('#promptInput').value.trim(); if (!name) return; const action = state.promptHandler; closeModal('promptModal'); state.promptHandler = null; action?.(name); });
    $$('.nav-item').forEach(button => button.addEventListener('click', () => { state.scope = button.dataset.scope; state.parentId = null; state.query = ''; $('#searchInput').value = ''; loadFiles(); }));
    $('#uploadButton').addEventListener('click', () => $('#fileInput').click()); $('#uploadButtonMobile').addEventListener('click', () => $('#fileInput').click()); $('#emptyUploadButton').addEventListener('click', () => $('#fileInput').click()); $('#fileInput').addEventListener('change', event => { handleFiles(event.target.files); event.target.value = ''; }); $('#newFolderButton').addEventListener('click', openNewFolder); $('#closeUploadTray').addEventListener('click', () => { $('#uploadTray').hidden = true; });
    $$('.view-switcher [data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; localStorage.setItem(KEYS.view, state.view); $$('.view-switcher [data-view]').forEach(node => node.classList.toggle('is-active', node === button)); renderFiles(); }));
    let searchTimer; $('#searchInput').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query = event.target.value.trim(); loadFiles(); }, 260); });
    $('#languageButton').addEventListener('click', () => { state.lang = state.lang === 'vi' ? 'en' : 'vi'; localStorage.setItem(KEYS.lang, state.lang); render(); }); $('#themeButton').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem(KEYS.theme, state.theme); applyTranslations(); }); $('#accountButton').addEventListener('click', signOut);
    const fileArea = $('#fileArea'); ['dragenter', 'dragover'].forEach(type => fileArea.addEventListener(type, event => { event.preventDefault(); fileArea.classList.add('is-dragging'); })); ['dragleave', 'drop'].forEach(type => fileArea.addEventListener(type, event => { event.preventDefault(); fileArea.classList.remove('is-dragging'); })); fileArea.addEventListener('drop', event => { if (event.dataTransfer?.files) handleFiles(event.dataTransfer.files); });
    $('#mobileMenu').addEventListener('click', () => $('.sidebar').classList.toggle('is-open')); document.addEventListener('click', () => $$('.file-menu.is-open').forEach(menu => menu.classList.remove('is-open'))); document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } if (event.key === 'Escape') { $$('.file-menu.is-open').forEach(menu => menu.classList.remove('is-open')); ['settingsModal', 'promptModal'].forEach(closeModal); } }); window.addEventListener('beforeunload', event => { if (state.uploadingCount > 0) { event.preventDefault(); event.returnValue = ''; } });
  }

  function initialise() { bindEvents(); applyTranslations(); $$('.view-switcher [data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === state.view)); if (state.apiUrl && state.token) loadFiles(); else showLogin(); }
  initialise();
})();
