/**
 * TG-Drive Pro — Frontend Client (FULL TELEGRAM ARCHITECTURE)
 * ---------------------------------------------------------------
 * KHÔNG dùng Supabase / IndexedDB metadata / bất kỳ DB ngoài nào.
 * Toàn bộ Data (chunks) và Metadata (danh sách file) đều nằm trên
 * Telegram Private Channel, thông qua Cloudflare Worker Proxy.
 *
 * Yêu cầu index.html tối thiểu phải có các phần tử với id sau
 * (đổi tên trong CONFIG DOM bên dưới nếu index.html của bạn khác):
 *   #file-input          <input type="file" multiple>
 *   #btn-upload-trigger  nút bấm để mở file-input
 *   #file-list-body      <tbody> để render danh sách file
 *   #total-files         hiển thị tổng số file
 *   #total-size          hiển thị tổng dung lượng
 *   #progress-panel      panel hiển thị tiến trình upload
 *   #progress-file-name  tên file đang upload
 *   #progress-bar        thanh progress (dùng style.width)
 *   #progress-text       text %/tốc độ
 *   #toast-container     (tự tạo nếu chưa có)
 */

// =====================================================================
// CONFIG
// =====================================================================
const API = 'https://drive-worker.phamdatt140613.workers.dev'; // ĐỔI thành URL Worker của bạn
const ACCESS_PASSWORD = localStorage.getItem('tgdrive_access_password') || '140613';

const CHUNK_SIZE = 19 * 1024 * 1024; // ~19MB / chunk (an toàn dưới giới hạn ~20MB của Telegram Bot API)
const MAX_RETRY = 5;
const RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s, 8s, 16s

// =====================================================================
// STATE
// =====================================================================
let metadataCache = { version: 1, updated_at: null, files: [] };
let isUploading = false;
let uploadCancelled = false;

// =====================================================================
// DOM REFERENCES
// =====================================================================
const el = {
    fileInput:      document.getElementById('file-input'),
    uploadBtn:      document.getElementById('btn-upload-trigger'),
    listBody:       document.getElementById('file-list-body'),
    totalFiles:     document.getElementById('total-files'),
    totalSize:      document.getElementById('total-size'),
    progressPanel:  document.getElementById('progress-panel'),
    progressName:   document.getElementById('progress-file-name'),
    progressBar:    document.getElementById('progress-bar'),
    progressText:   document.getElementById('progress-text')
};

// =====================================================================
// INIT
// =====================================================================
async function initApp() {
    try {
        if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            try {
                if (tg.themeParams && tg.themeParams.bg_color) {
                    document.body.style.backgroundColor = tg.themeParams.bg_color;
                }
            } catch (e) { /* bỏ qua nếu theme không khả dụng */ }
        }

        bindEvents();

        showToast('Đang tải danh sách file...', 'info');
        await loadMetadata();
        renderUI();
        showToast('Đã sẵn sàng.', 'success');
    } catch (err) {
        console.error('initApp error:', err);
        showToast('Lỗi khởi tạo ứng dụng: ' + err.message, 'danger');
    }
}

function bindEvents() {
    if (el.uploadBtn && el.fileInput) {
        el.uploadBtn.addEventListener('click', () => el.fileInput.click());
    }
    if (el.fileInput) {
        el.fileInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = ''; // reset để chọn lại cùng file được
            for (const file of files) {
                await uploadFile(file);
            }
        });
    }
    if (el.listBody) {
        el.listBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const id = btn.dataset.id;
            const action = btn.dataset.action;
            if (action === 'download') await downloadFile(id);
            if (action === 'delete') await deleteFile(id);
        });
    }
    window.addEventListener('beforeunload', (e) => {
        if (isUploading) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

// =====================================================================
// API HELPERS
// =====================================================================
function apiHeadersJson() {
    return { 'Authorization': ACCESS_PASSWORD, 'Content-Type': 'application/json' };
}

async function fetchWithRetry(url, options, maxRetry = MAX_RETRY) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetry; attempt++) {
        try {
            const res = await fetch(url, options);
            if (!res.ok) {
                let detail = '';
                try {
                    const data = await res.json();
                    detail = data.error || JSON.stringify(data);
                } catch (e) {
                    detail = `HTTP ${res.status}`;
                }
                throw new Error(detail);
            }
            return res;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetry) {
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                await sleep(delay);
                continue;
            }
        }
    }
    throw lastError;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================================================
// METADATA
// =====================================================================
async function loadMetadata() {
    const res = await fetchWithRetry(`${API}/metadata/get`, {
        method: 'GET',
        headers: { 'Authorization': ACCESS_PASSWORD }
    });
    const data = await res.json();
    metadataCache = data.metadata || { version: 1, updated_at: null, files: [] };
    return metadataCache;
}

async function saveMetadata() {
    const res = await fetchWithRetry(`${API}/metadata/save`, {
        method: 'POST',
        headers: apiHeadersJson(),
        body: JSON.stringify({ metadata: metadataCache })
    });
    return res.json();
}

// =====================================================================
// UPLOAD
// =====================================================================
async function uploadFile(file) {
    if (isUploading) {
        showToast('Đang có 1 tiến trình upload khác, vui lòng đợi.', 'danger');
        return;
    }

    isUploading = true;
    uploadCancelled = false;
    const fileId = generateId();
    const totalParts = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const parts = [];

    showProgress(file.name, 0, `0 / ${totalParts} phần`);

    try {
        for (let index = 0; index < totalParts; index++) {
            if (uploadCancelled) throw new Error('Upload đã bị huỷ.');

            const start = index * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunkBlob = file.slice(start, end);

            const partInfo = await uploadChunkWithRetry(chunkBlob, `${file.name}.part${index}`, (pct) => {
                const overallPct = Math.round(((index + pct / 100) / totalParts) * 100);
                showProgress(file.name, overallPct, `Phần ${index + 1}/${totalParts} — ${pct}%`);
            });

            parts.push({
                part_index: index,
                telegram_file_id: partInfo.telegram_file_id,
                telegram_message_id: partInfo.telegram_message_id,
                size: partInfo.size
            });

            showProgress(file.name, Math.round(((index + 1) / totalParts) * 100), `${index + 1} / ${totalParts} phần`);
        }

        const fileRecord = {
            id: fileId,
            name: file.name,
            size: file.size,
            mime_type: file.type || 'application/octet-stream',
            created_at: new Date().toISOString(),
            part_count: parts.length,
            parts
        };

        metadataCache.files.push(fileRecord);
        await saveMetadata();

        renderUI();
        showToast(`Đã upload xong "${file.name}".`, 'success');
    } catch (err) {
        console.error('uploadFile error:', err);
        showToast(`Lỗi upload "${file.name}": ${err.message}`, 'danger');

        // Dọn dẹp các chunk đã upload dở dang trên Telegram (best-effort)
        for (const part of parts) {
            try {
                await fetchWithRetry(`${API}/delete`, {
                    method: 'POST',
                    headers: apiHeadersJson(),
                    body: JSON.stringify({ message_id: part.telegram_message_id })
                }, 1);
            } catch (e) { /* bỏ qua lỗi dọn dẹp */ }
        }
    } finally {
        isUploading = false;
        hideProgress();
    }
}

async function uploadChunkWithRetry(chunkBlob, filename, onProgress) {
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
        try {
            return await uploadChunkOnce(chunkBlob, filename, onProgress);
        } catch (err) {
            lastError = err;
            if (attempt < MAX_RETRY) {
                const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                showToast(`Chunk lỗi, thử lại sau ${delay / 1000}s (lần ${attempt + 1}/${MAX_RETRY})...`, 'info');
                await sleep(delay);
                continue;
            }
        }
    }
    throw new Error(`Upload chunk thất bại sau ${MAX_RETRY} lần thử: ${lastError.message}`);
}

function uploadChunkOnce(chunkBlob, filename, onProgress) {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', chunkBlob, filename);
        form.append('filename', filename);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API}/upload`, true);
        xhr.setRequestHeader('Authorization', ACCESS_PASSWORD);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = () => {
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
                    resolve(data);
                } else {
                    reject(new Error(data.error || `HTTP ${xhr.status}`));
                }
            } catch (e) {
                reject(new Error('Phản hồi không hợp lệ từ Worker.'));
            }
        };

        xhr.onerror = () => reject(new Error('Lỗi mạng khi upload chunk.'));
        xhr.onabort = () => reject(new Error('Upload bị huỷ.'));

        xhr.send(form);
    });
}

// =====================================================================
// DOWNLOAD (ghép các part lại thành 1 file hoàn chỉnh, tải về trình duyệt)
// =====================================================================
async function downloadFile(id) {
    const file = metadataCache.files.find((f) => f.id === id);
    if (!file) return showToast('Không tìm thấy file.', 'danger');

    showToast(`Đang chuẩn bị tải "${file.name}"...`, 'info');
    showProgress(file.name, 0, `0 / ${file.parts.length} phần`);

    try {
        const sortedParts = [...file.parts].sort((a, b) => a.part_index - b.part_index);
        const blobParts = [];

        for (let i = 0; i < sortedParts.length; i++) {
            const part = sortedParts[i];
            const res = await fetchWithRetry(
                `${API}/download?file_id=${encodeURIComponent(part.telegram_file_id)}`,
                { method: 'GET', headers: { 'Authorization': ACCESS_PASSWORD } }
            );
            const blob = await res.blob();
            blobParts.push(blob);
            showProgress(file.name, Math.round(((i + 1) / sortedParts.length) * 100), `${i + 1} / ${sortedParts.length} phần`);
        }

        const fullBlob = new Blob(blobParts, { type: file.mime_type || 'application/octet-stream' });
        const url = URL.createObjectURL(fullBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        showToast(`Đã tải xong "${file.name}".`, 'success');
    } catch (err) {
        console.error('downloadFile error:', err);
        showToast(`Lỗi tải "${file.name}": ${err.message}`, 'danger');
    } finally {
        hideProgress();
    }
}

// =====================================================================
// DELETE
// =====================================================================
async function deleteFile(id) {
    const file = metadataCache.files.find((f) => f.id === id);
    if (!file) return showToast('Không tìm thấy file.', 'danger');

    if (!confirm(`Xoá "${file.name}" khỏi Telegram?`)) return;

    try {
        for (const part of file.parts) {
            try {
                await fetchWithRetry(`${API}/delete`, {
                    method: 'POST',
                    headers: apiHeadersJson(),
                    body: JSON.stringify({ message_id: part.telegram_message_id })
                }, 2);
            } catch (e) {
                console.warn(`Không xoá được part ${part.part_index} của "${file.name}":`, e.message);
            }
        }

        metadataCache.files = metadataCache.files.filter((f) => f.id !== id);
        await saveMetadata();

        renderUI();
        showToast(`Đã xoá "${file.name}".`, 'success');
    } catch (err) {
        console.error('deleteFile error:', err);
        showToast('Lỗi xoá file: ' + err.message, 'danger');
    }
}

// =====================================================================
// RENDER UI
// =====================================================================
function renderUI() {
    const files = metadataCache.files || [];
    const totalBytes = files.reduce((sum, f) => sum + Number(f.size || 0), 0);

    if (el.totalFiles) el.totalFiles.textContent = files.length;
    if (el.totalSize) el.totalSize.textContent = formatSize(totalBytes);

    if (el.listBody) {
        if (files.length === 0) {
            el.listBody.innerHTML = `<tr><td colspan="4" style="text-align:center;opacity:.6">Chưa có file nào.</td></tr>`;
        } else {
            el.listBody.innerHTML = files.map(rowTemplate).join('');
        }
    }
}

function rowTemplate(file) {
    return `<tr>
        <td>${escapeHtml(file.name)}</td>
        <td>${formatSize(file.size)}</td>
        <td>${formatDate(file.created_at)}</td>
        <td>
            <button data-action="download" data-id="${file.id}">Tải về</button>
            <button data-action="delete" data-id="${file.id}">Xoá</button>
        </td>
    </tr>`;
}

// =====================================================================
// PROGRESS / TOAST HELPERS
// =====================================================================
function showProgress(name, percent, text) {
    if (!el.progressPanel) return;
    el.progressPanel.style.display = 'block';
    if (el.progressName) el.progressName.textContent = name;
    if (el.progressBar) el.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (el.progressText) el.progressText.textContent = text || `${percent}%`;
}

function hideProgress() {
    if (el.progressPanel) el.progressPanel.style.display = 'none';
}

function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(container);
    }
    const item = document.createElement('div');
    item.textContent = message;
    item.style.cssText = `padding:10px 14px;border-radius:8px;color:#fff;font-size:13px;
        background:${type === 'danger' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
        box-shadow:0 4px 12px rgba(0,0,0,.25);`;
    container.appendChild(item);
    setTimeout(() => item.remove(), 3500);
}

// =====================================================================
// UTILS
// =====================================================================
function generateId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function formatSize(bytes) {
    bytes = Number(bytes || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString('vi-VN') : '-';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    }[char]));
}

// =====================================================================
// BOOT
// =====================================================================
document.addEventListener('DOMContentLoaded', initApp);