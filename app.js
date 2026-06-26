/**
 * TG-Drive Pro — Frontend Logic v5.0
 * ============================================================
 * - Tất cả selector ID khớp 100% với index.html
 * - Upload: Dynamic Chunking (max 19.5MB/part), IndexedDB resume
 * - Fault-Tolerance: offline/online auto-pause/resume, beforeunload
 * - Exponential Backoff retry (5 lần: 1s→2s→4s→8s→16s)
 * - Download: StreamSaver piping, không ngốn RAM
 * - UI: Kebab menu, Bulk delete, Clear-all, Preview, Details
 * - Toast system, Activity log
 * ============================================================
 */

"use strict";

// ============================================================
// CONFIGURATION
// ============================================================
const API          = "https://drive-worker.phamdatt140613.workers.dev";
const AUTH_HEADER  = "140613";
const PASSWORD     = "140613";

// Dynamic chunking constants
const MAX_PART_SIZE     = 19.5 * 1024 * 1024;   // Hard cap: 19.5 MB
const MIN_PART_SIZE     = 3   * 1024 * 1024;     // 3 MB minimum
const UPLOAD_CONCURRENCY = 2;

// File type maps
const EXT_IMAGE  = ["jpg","jpeg","png","gif","webp","bmp","svg","ico"];
const EXT_VIDEO  = ["mp4","webm","ogg","mov","mkv","avi"];
const EXT_AUDIO  = ["mp3","wav","m4a","aac","flac","ogg"];
const EXT_PDF    = ["pdf"];
const EXT_DOC    = ["doc","docx","xls","xlsx","ppt","pptx","txt","md","csv"];
const EXT_ARCHIVE= ["zip","rar","7z","tar","gz","bz2"];

// ============================================================
// DYNAMIC CHUNKING ALGORITHM
// Tính kích thước part tối ưu theo dung lượng file.
// Quy tắc: < 10MB → 1 part; 10-100MB → ~5-10MB/part; >100MB → scale up.
// TUYỆT ĐỐI không vượt MAX_PART_SIZE = 19.5MB.
// ============================================================
function calcPartSize(fileSize) {
    let size;
    if (fileSize <= 10 * 1024 * 1024) {
        size = fileSize;                              // ≤10MB → nguyên 1 part
    } else if (fileSize <= 50 * 1024 * 1024) {
        size = 5 * 1024 * 1024;                      // 10–50MB → 5MB/part
    } else if (fileSize <= 200 * 1024 * 1024) {
        size = 10 * 1024 * 1024;                     // 50–200MB → 10MB/part
    } else if (fileSize <= 500 * 1024 * 1024) {
        size = 15 * 1024 * 1024;                     // 200–500MB → 15MB/part
    } else {
        size = MAX_PART_SIZE;                         // >500MB → 19.5MB/part
    }
    return Math.min(Math.max(size, MIN_PART_SIZE), MAX_PART_SIZE);
}

// ============================================================
// STATE
// ============================================================
let allFiles   = [];
let sortKey    = "created_at";
let sortDir    = -1;
let currentView= localStorage.getItem("tgdrive_view") || "list";
let isOnline   = navigator.onLine;

let uploadState = {
    file: null, fileId: "", partSize: 0, totalParts: 0,
    currentPart: 0, paused: false, cancelled: false, sessionKey: ""
};
let activeDownload = false;

// ============================================================
// DOM REFERENCES  (mọi id khớp với index.html)
// ============================================================
const loginPage       = document.getElementById("login-page");
const dashboard       = document.getElementById("dashboard");
const loginForm       = document.getElementById("login-form");
const passwordInput   = document.getElementById("password-input");
const loginErrorEl    = document.getElementById("login-error");

const btnUploadTrigger= document.getElementById("btn-upload-trigger");
const fileInput       = document.getElementById("file-input");            // ← #file-input
const btnLogout       = document.getElementById("btn-logout");

const searchInput     = document.getElementById("search-input");
const totalFilesCount = document.getElementById("total-files-count");
const totalSizeLabel  = document.getElementById("total-size-label");
const usedSizeLabel   = document.getElementById("used-size-label");
const storageFill     = document.getElementById("storage-fill");

const btnClearAll     = document.getElementById("btn-clear-all");         // ← #btn-clear-all
const btnBulkDelete   = document.getElementById("btn-bulk-delete");       // ← #btn-bulk-delete
const btnDeselectAll  = document.getElementById("btn-deselect-all");
const bulkActionsBar  = document.getElementById("bulk-actions-bar");
const selectCountEl   = document.getElementById("select-count");
const dataScroller    = document.getElementById("data-view-scroller");

const miniPanel       = document.getElementById("mini-progress-panel");
const miniPanelTitle  = document.getElementById("mini-panel-title");
const miniPanelToggle = document.getElementById("mini-panel-toggle");
const miniPanelBody   = document.getElementById("mini-panel-body");
const uploadRow       = document.getElementById("upload-row");
const downloadRow     = document.getElementById("download-row");

const uploadFileName  = document.querySelector(".uploading-file-name");
const uploadStatusEl  = document.querySelector(".upload-status");
const uploadBar       = document.querySelector(".manager-upload-progress-bar");
const currentPartEl   = document.querySelector(".current-part");
const btnPause        = document.getElementById("btn-pause");
const btnResume       = document.getElementById("btn-resume");
const btnCancelUpload = document.getElementById("btn-cancel-upload");

const downloadFileName= document.querySelector(".downloading-file-name");
const downloadStatusEl= document.querySelector(".download-status");
const downloadBar     = document.querySelector(".download-progress-bar");

const detailsPanel    = document.getElementById("details-panel");
const detailIdEl      = document.querySelector(".detail-id");
const detailNameEl    = document.querySelector(".detail-name");
const detailSizeEl    = document.querySelector(".detail-size");
const detailPartsEl   = document.querySelector(".detail-parts");
const detailStatusEl  = document.querySelector(".detail-status");
const partTableBody   = document.querySelector(".part-table-body");

const logList         = document.getElementById("log-list");
const previewModal    = document.getElementById("preview-modal");
const previewTitle    = document.getElementById("preview-title");
const previewBody     = document.getElementById("preview-body");
const toastContainer  = document.getElementById("toast-container");

// ============================================================
// INDEXEDDB
// ============================================================
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("tgdrive_db", 1);
        req.onupgradeneeded = () => {
            const idb = req.result;
            if (!idb.objectStoreNames.contains("upload_progress")) {
                idb.createObjectStore("upload_progress", { keyPath: "sessionKey" });
            }
        };
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onerror   = () => reject(req.error);
    });
}
function dbPut(store, val) {
    return new Promise((res, rej) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(val);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
    });
}
function dbGet(store, key) {
    return new Promise((res, rej) => {
        const tx  = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror   = () => rej(req.error);
    });
}
function dbDelete(store, key) {
    return new Promise((res, rej) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => res();
        tx.onerror    = () => rej(tx.error);
    });
}
function dbGetAll(store) {
    return new Promise((res, rej) => {
        const tx  = db.transaction(store, "readonly");
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror   = () => rej(req.error);
    });
}

// ============================================================
// FAULT-TOLERANCE: OFFLINE / ONLINE
// ============================================================
window.addEventListener("offline", () => {
    isOnline = false;
    if (uploadState.file && !uploadState.paused) {
        uploadState.paused = true;
        setUploadPaused(true);
        setUploadStatus("⚠ Mất mạng – Đang tạm ngưng...");
        showToast("Mất kết nối mạng. Upload tự động tạm dừng.", "warning");
        addLog("[Hệ thống] Mất mạng – Upload tạm ngưng.");
    }
    if (activeDownload) {
        showToast("Mất mạng trong khi tải xuống!", "warning");
    }
});

window.addEventListener("online", () => {
    isOnline = true;
    showToast("Kết nối mạng được khôi phục.", "success");
    addLog("[Hệ thống] Kết nối trở lại.");
    if (uploadState.file && uploadState.paused && !uploadState.cancelled) {
        // Auto-resume sau 800ms để đảm bảo mạng ổn định
        setTimeout(() => {
            if (!isOnline || uploadState.cancelled || !uploadState.paused) return;
            uploadState.paused = false;
            setUploadPaused(false);
            setUploadStatus("⚡ Mạng trở lại – Đang tiếp tục...");
            addLog("[Hệ thống] Tự động tiếp tục upload.");
            runUploadLoop();
        }, 800);
    }
});

// Chặn F5 / đóng tab khi đang upload/download
window.addEventListener("beforeunload", (e) => {
    const uploading = uploadState.file && !uploadState.cancelled;
    if (uploading || activeDownload) {
        e.preventDefault();
        e.returnValue = "Có tiến trình tải lên/xuống đang chạy. Rời trang có thể làm mất dữ liệu!";
        return e.returnValue;
    }
});

// ============================================================
// EXPONENTIAL BACKOFF FETCH WRAPPER
// ============================================================
async function fetchWithRetry(url, options = {}, maxRetries = 5) {
    let delay = 1000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.status >= 500) throw new Error(`Server error ${res.status}`);
            return res;
        } catch (err) {
            if (attempt === maxRetries) throw err;
            const isNetworkErr = !navigator.onLine || err.message.includes("fetch") || err.name === "TypeError";
            if (!isNetworkErr && !(err.message.startsWith("Server error"))) throw err;
            addLog(`[Retry] Lần ${attempt}/${maxRetries} thất bại. Thử lại sau ${delay/1000}s…`);
            await sleep(delay);
            delay = Math.min(delay * 2, 16000);
        }
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// TOAST SYSTEM
// ============================================================
function showToast(message, type = "info", duration = 4000) {
    const icons = { success:"✅", danger:"❌", error:"❌", warning:"⚠️", info:"ℹ️" };
    const colors = {
        success: "#10b981", danger: "#f43f5e", error: "#f43f5e",
        warning: "#f59e0b", info: "#6366f1"
    };
    const toast = document.createElement("div");
    toast.className = "toast-msg";
    toast.style.borderLeftColor = colors[type] || colors.info;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-text">${escapeHtml(message)}</span>
        <button class="toast-close" title="Đóng">✕</button>`;
    toast.querySelector(".toast-close").addEventListener("click", () => removeToast(toast));
    if (toastContainer) toastContainer.appendChild(toast);
    if (duration > 0) setTimeout(() => removeToast(toast), duration);
}
function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.style.opacity  = "0";
    el.style.transform= "translateX(60px)";
    setTimeout(() => el.remove(), 350);
}

// ============================================================
// INIT
// ============================================================
(async function init() {
    await openDB();
    setupViewToggles();
    setupMiniPanel();

    if (localStorage.getItem("drive_auth") === "1") {
        showDashboard();
    } else {
        showLogin();
    }
    await checkPendingUploads();
})();

// ============================================================
// AUTH
// ============================================================
function showLogin() {
    if (loginPage) loginPage.style.display = "flex";
    if (dashboard)  dashboard.style.display = "none";
}
function showDashboard() {
    if (loginPage) loginPage.style.display = "none";
    if (dashboard)  dashboard.style.display = "flex";
    loadFiles();
}

if (loginForm) {
    loginForm.addEventListener("submit", e => {
        e.preventDefault();
        const pass = passwordInput ? passwordInput.value.trim() : "";
        if (pass === PASSWORD) {
            localStorage.setItem("drive_auth", "1");
            if (loginErrorEl) loginErrorEl.style.display = "none";
            showToast("Đăng nhập thành công!", "success");
            showDashboard();
        } else {
            if (loginErrorEl) {
                loginErrorEl.textContent = "❌ Mật khẩu không đúng!";
                loginErrorEl.style.display = "block";
            }
            showToast("Mật khẩu truy cập không chính xác!", "danger");
        }
    });
}

if (btnLogout) {
    btnLogout.addEventListener("click", () => {
        localStorage.removeItem("drive_auth");
        location.reload();
    });
}

// ============================================================
// INDEXEDDB – CHECK PENDING UPLOADS (Auto-Recovery)
// ============================================================
async function checkPendingUploads() {
    if (!db) return;
    const pending = await dbGetAll("upload_progress");
    if (pending.length === 0) return;

    pending.forEach(p => {
        const done  = p.doneParts ? p.doneParts.length : 0;
        const total = p.totalParts || 1;
        addLog(`[Resume] Phát hiện tệp chưa hoàn tất: ${p.name} (${done}/${total} parts)`);
    });

    showToast(
        `Phát hiện ${pending.length} tệp tin tải lên dở dang. Chọn lại tệp gốc để tiếp tục.`,
        "warning",
        8000
    );
}

// ============================================================
// VIEW TOGGLES
// ============================================================
function setupViewToggles() {
    const toggleBtns = document.querySelectorAll(".btn-toggle");
    toggleBtns.forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === currentView);
        btn.addEventListener("click", () => {
            currentView = btn.dataset.view;
            localStorage.setItem("tgdrive_view", currentView);
            toggleBtns.forEach(b => b.classList.toggle("active", b.dataset.view === currentView));
            renderFiles();
        });
    });
}

// ============================================================
// MINI PROGRESS PANEL
// ============================================================
function setupMiniPanel() {
    if (!miniPanelToggle) return;
    miniPanelToggle.addEventListener("click", () => {
        const collapsed = miniPanel.classList.toggle("mini-panel-collapsed");
        miniPanelToggle.textContent = collapsed ? "+" : "−";
    });
}

function showMiniPanel(mode) {
    if (!miniPanel) return;
    miniPanel.style.display = "block";
    if (miniPanelTitle) {
        miniPanelTitle.textContent = mode === "upload" ? "📤 Đang tải lên..." : "📥 Đang tải xuống...";
    }
    if (uploadRow)   uploadRow.style.display   = mode === "upload"   ? "flex" : "none";
    if (downloadRow) downloadRow.style.display = mode === "download" ? "flex" : "none";
}

function hideMiniPanel(mode) {
    if (mode === "upload"   && uploadRow)   uploadRow.style.display   = "none";
    if (mode === "download" && downloadRow) downloadRow.style.display = "none";
    const bothHidden =
        (!uploadRow   || uploadRow.style.display   === "none") &&
        (!downloadRow || downloadRow.style.display === "none");
    if (bothHidden && miniPanel) miniPanel.style.display = "none";
}

// ============================================================
// UPLOAD – TRIGGER
// ============================================================
if (btnUploadTrigger) {
    btnUploadTrigger.addEventListener("click", () => {
        if (fileInput) fileInput.click();
    });
}

if (fileInput) {                                // ← #file-input (khớp HTML)
    fileInput.addEventListener("change", () => {
        if (!fileInput.files || fileInput.files.length === 0) return;
        if (uploadState.file && !uploadState.cancelled) {
            showToast("Upload khác đang chạy! Hãy chờ hoặc hủy trước.", "warning");
            return;
        }
        startUpload();
    });
}

if (btnPause) {
    btnPause.addEventListener("click", () => {
        uploadState.paused = true;
        setUploadPaused(true);
        setUploadStatus("⏸ Tạm dừng");
        addLog("[Upload] Người dùng tạm dừng.");
        showToast("Đã tạm dừng upload.", "info");
    });
}

if (btnResume) {
    btnResume.addEventListener("click", () => {
        if (!uploadState.file) {
            showToast("Không tìm thấy file gốc. Hãy chọn lại.", "danger"); return;
        }
        if (!uploadState.paused) return;
        uploadState.paused = false;
        setUploadPaused(false);
        setUploadStatus("⚡ Đang tiếp tục...");
        addLog("[Upload] Người dùng tiếp tục.");
        runUploadLoop();
    });
}

if (btnCancelUpload) {
    btnCancelUpload.addEventListener("click", () => {
        uploadState.cancelled = true;
        uploadState.paused    = true;
        resetUploadUI();
        hideMiniPanel("upload");
        if (fileInput) fileInput.value = "";
        addLog("[Upload] Đã hủy tiến trình tải lên.");
        showToast("Đã hủy tải lên.", "info");
    });
}

function setUploadPaused(paused) {
    if (btnPause)  btnPause.style.display  = paused ? "none"  : "inline-flex";
    if (btnResume) btnResume.style.display = paused ? "inline-flex" : "none";
}

function setUploadStatus(text) {
    if (uploadStatusEl) uploadStatusEl.textContent = text;
}

function resetUploadUI() {
    uploadState = { file:null, fileId:"", partSize:0, totalParts:0, currentPart:0, paused:false, cancelled:false, sessionKey:"" };
    if (uploadBar) uploadBar.style.width = "0%";
    setUploadStatus("0%");
    if (currentPartEl) currentPartEl.textContent = "0/0 part";
    if (btnUploadTrigger) btnUploadTrigger.classList.remove("btn-pulse-active");
}

// ============================================================
// UPLOAD – CORE PIPELINE
// ============================================================
async function startUpload() {
    const file      = fileInput.files[0];
    if (!file) return;

    const partSize  = calcPartSize(file.size);   // ← Dynamic chunking
    const totalParts= Math.ceil(file.size / partSize);
    const sessionKey= `${file.name}_${file.size}_${file.lastModified}`;

    // Check IndexedDB for existing progress
    let progress = await dbGet("upload_progress", sessionKey);
    if (progress && progress.totalParts === totalParts) {
        addLog(`[Resume] Tiếp tục từ part ${progress.doneParts.length}/${totalParts}.`);
        showToast("Đang kết nối lại tiến trình dở dang...", "info");
    } else {
        progress = {
            sessionKey, fileId: "", partSize, totalParts,
            doneParts: [], name: file.name, size: file.size,
            mimeType: file.type || "application/octet-stream"
        };
        await dbPut("upload_progress", progress);
    }

    uploadState = {
        file, fileId: progress.fileId || "", partSize, totalParts,
        currentPart: progress.doneParts.length,
        paused: false, cancelled: false, sessionKey
    };

    showMiniPanel("upload");
    if (uploadFileName) uploadFileName.textContent = file.name;
    setUploadPaused(false);
    if (btnUploadTrigger) btnUploadTrigger.classList.add("btn-pulse-active");

    addLog(`[Upload] Bắt đầu: ${file.name} | ${formatSize(file.size)} | ${totalParts} parts | ${formatSize(partSize)}/part`);
    runUploadLoop();
}

async function runUploadLoop() {
    const progress = await dbGet("upload_progress", uploadState.sessionKey);
    if (!progress) return;

    const { file, partSize, totalParts } = uploadState;
    const pendingQueue = [];
    for (let i = 1; i <= totalParts; i++) {
        if (!progress.doneParts.includes(i)) pendingQueue.push(i);
    }

    updateUploadProgressUI(progress.doneParts.length, totalParts);

    const worker = async () => {
        while (pendingQueue.length > 0) {
            if (uploadState.paused || uploadState.cancelled) return;

            const partIndex = pendingQueue.shift();
            if (partIndex === undefined) break;

            const start    = (partIndex - 1) * partSize;
            const end      = Math.min(start + partSize, file.size);
            const chunk    = file.slice(start, end);

            try {
                const result = await uploadPartWithRetry(chunk, {
                    fileId:    uploadState.fileId,
                    fileName:  file.name,
                    fileSize:  file.size,
                    partIndex,
                    totalParts,
                    mimeType:  progress.mimeType
                });

                if (!uploadState.fileId && result.id) {
                    uploadState.fileId = result.id;
                }

                const live = await dbGet("upload_progress", uploadState.sessionKey);
                if (live) {
                    if (!live.doneParts.includes(partIndex)) {
                        live.doneParts.push(partIndex);
                        live.doneParts.sort((a,b) => a - b);
                    }
                    if (uploadState.fileId) live.fileId = uploadState.fileId;
                    await dbPut("upload_progress", live);
                    progress.doneParts = live.doneParts;
                    uploadState.currentPart = live.doneParts.length;
                }

                addLog(`[Upload] Part ${partIndex}/${totalParts} ✓`);
                updateUploadProgressUI(progress.doneParts.length, totalParts);

            } catch (err) {
                pendingQueue.unshift(partIndex);
                setUploadStatus(`❌ Lỗi part ${partIndex} – tự động tạm dừng`);
                showToast(`Upload bị gián đoạn ở part ${partIndex}: ${err.message}`, "danger");
                uploadState.paused = true;
                setUploadPaused(true);
                addLog(`[Upload] Lỗi part ${partIndex}: ${err.message}`);
                return;
            }
        }
    };

    // Parallel workers
    const threads = Math.min(UPLOAD_CONCURRENCY, pendingQueue.length || 1);
    const workers = Array.from({ length: threads }, () => worker());
    await Promise.all(workers);

    // Check completion
    if (!uploadState.paused && !uploadState.cancelled) {
        const final = await dbGet("upload_progress", uploadState.sessionKey);
        if (final && final.doneParts.length === totalParts) {
            if (uploadBar) uploadBar.style.width = "100%";
            setUploadStatus("✅ Hoàn tất!");
            showToast(`Tải lên hoàn tất: ${file.name}`, "success");
            await dbDelete("upload_progress", uploadState.sessionKey);
            addLog(`[Upload] Hoàn tất: ${file.name}`);
            if (btnUploadTrigger) btnUploadTrigger.classList.remove("btn-pulse-active");
            if (fileInput) fileInput.value = "";
            setTimeout(() => hideMiniPanel("upload"), 2000);
            resetUploadUI();
            loadFiles();
        }
    }
}

async function uploadPartWithRetry(blob, meta) {
    const form = new FormData();
    form.append("file", new File([blob], `${meta.fileName}.part${meta.partIndex}`, { type: meta.mimeType }));
    form.append("original_name", meta.fileName);
    form.append("original_size", String(meta.fileSize));
    form.append("part_index",    String(meta.partIndex));
    form.append("part_count",    String(meta.totalParts));
    form.append("mime_type",     meta.mimeType);
    form.append("file_id",       meta.fileId || "");

    const res = await fetchWithRetry(API + "/upload", {
        method: "POST",
        headers: { Authorization: AUTH_HEADER },
        body: form
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

function updateUploadProgressUI(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (uploadBar)     uploadBar.style.width = pct + "%";
    if (currentPartEl) currentPartEl.textContent = `${done}/${total} parts`;
    setUploadStatus(`${pct}% (${done}/${total})`);
}

// ============================================================
// LOAD FILE LIST
// ============================================================
async function loadFiles() {
    try {
        const res = await fetchWithRetry(API + "/files", {
            headers: { Authorization: AUTH_HEADER }
        });
        const data = await res.json();
        if (!Array.isArray(data)) { console.error(data); return; }
        allFiles = data;
        renderFiles();
    } catch (err) {
        console.error(err);
        showToast("Không thể tải danh sách tệp tin!", "danger");
    }
}

// ============================================================
// RENDER FILES (LIST / GRID)
// ============================================================
function getFilteredSorted() {
    let files = allFiles.slice();
    const q = searchInput ? searchInput.value.trim().toLowerCase() : "";
    if (q) files = files.filter(f => (f.name||"").toLowerCase().includes(q));
    if (sortKey) {
        files.sort((a, b) => {
            let va = a[sortKey] || 0, vb = b[sortKey] || 0;
            if (sortKey === "name") {
                va = (va+"").toLowerCase(); vb = (vb+"").toLowerCase();
                return va.localeCompare(vb) * sortDir;
            }
            return (Number(va) - Number(vb)) * sortDir;
        });
    }
    return files;
}

function renderFiles() {
    const files = getFilteredSorted();

    // Update stats
    const totalBytes = allFiles.reduce((s, f) => s + Number(f.size||0), 0);
    if (totalFilesCount) totalFilesCount.textContent = allFiles.length;
    if (totalSizeLabel)  totalSizeLabel.textContent  = formatSize(totalBytes);
    if (usedSizeLabel)   usedSizeLabel.textContent   = formatSize(totalBytes);
    const pct = Math.min(100, Math.max(1, (totalBytes / (100*1024*1024*1024)) * 100));
    if (storageFill) storageFill.style.width = pct + "%";

    if (!dataScroller) return;

    if (files.length === 0) {
        dataScroller.innerHTML = `
            <div class="empty-state-view">
                <div class="empty-icon-box">🛸</div>
                <h3>Không có tệp tin nào</h3>
                <p>Kho lưu trữ trống hoặc từ khóa tìm kiếm không khớp.</p>
            </div>`;
        updateSelectCount();
        return;
    }

    if (currentView === "list") renderListView(files);
    else renderGridView(files);

    // Bind checkbox change
    dataScroller.querySelectorAll(".row-check").forEach(cb => {
        cb.addEventListener("change", updateSelectCount);
    });
    updateSelectCount();
}

function renderListView(files) {
    const sortArrow = (key) => sortKey === key ? (sortDir === 1 ? " ▲" : " ▼") : " ⇅";
    dataScroller.innerHTML = `
        <div class="table-wrapper">
        <table class="modern-table">
            <thead>
                <tr>
                    <th width="40"><input type="checkbox" id="select-all" class="custom-checkbox"></th>
                    <th width="50">#</th>
                    <th class="sortable-col" data-sort-col="name" style="cursor:pointer;">Tên tệp${sortArrow("name")}</th>
                    <th class="sortable-col" data-sort-col="size" style="cursor:pointer;" width="130">Dung lượng${sortArrow("size")}</th>
                    <th class="sortable-col" data-sort-col="created_at" style="cursor:pointer;" width="160">Ngày tạo${sortArrow("created_at")}</th>
                    <th width="52" style="text-align:right;"></th>
                </tr>
            </thead>
            <tbody id="file-tbody"></tbody>
        </table>
        </div>`;

    // Header sort
    dataScroller.querySelectorAll(".sortable-col").forEach(th => {
        th.addEventListener("click", () => {
            const col = th.dataset.sortCol;
            if (sortKey === col) sortDir = -sortDir;
            else { sortKey = col; sortDir = 1; }
            renderFiles();
        });
    });

    // Select-all
    const selectAll = document.getElementById("select-all");
    if (selectAll) {
        selectAll.addEventListener("change", () => {
            dataScroller.querySelectorAll(".row-check").forEach(cb => cb.checked = selectAll.checked);
            updateSelectCount();
        });
    }

    const tbody = document.getElementById("file-tbody");
    files.forEach((file, idx) => {
        const tr = document.createElement("tr");
        tr.dataset.id = file.id;
        const icon = getIconInfo(file.name);
        tr.innerHTML = `
            <td><input type="checkbox" class="row-check custom-checkbox" data-id="${file.id}"></td>
            <td style="color:var(--muted);font-size:12px;text-align:center;">${idx + 1}</td>
            <td>
                <div class="file-name-cell" title="${escapeHtml(file.name||'')}">
                    <div class="file-icon-box ${icon.cls}">${icon.emoji}</div>
                    <span class="file-name-text">${escapeHtml(file.name||'-')}</span>
                    ${(file.part_count||1) > 1 ? `<span class="badge badge-warning" style="font-size:10px;">${file.part_count} parts</span>` : ''}
                </div>
            </td>
            <td style="color:var(--muted);font-size:12px;">${formatSize(file.size||0)}</td>
            <td style="color:var(--muted);font-size:12px;">${formatDate(file.created_at)}</td>
            <td class="action-cell" style="text-align:right;">
                <button class="kebab-btn action-dots" data-id="${file.id}">⋮</button>
                ${buildKebabMenu(file)}
            </td>`;
        tbody.appendChild(tr);
    });
}

function renderGridView(files) {
    const grid = document.createElement("div");
    grid.className = "file-grid-view-container";
    dataScroller.innerHTML = "";
    dataScroller.appendChild(grid);

    files.forEach(file => {
        const icon = getIconInfo(file.name);
        const card = document.createElement("div");
        card.className = "grid-card";
        card.dataset.id = file.id;
        card.innerHTML = `
            <div class="grid-card-header">
                <input type="checkbox" class="row-check custom-checkbox" data-id="${file.id}">
                <div class="action-cell">
                    <button class="kebab-btn action-dots" data-id="${file.id}">⋮</button>
                    ${buildKebabMenu(file)}
                </div>
            </div>
            <div class="grid-icon-preview ${icon.cls}">${icon.emoji}</div>
            <div class="grid-card-body">
                <div class="file-name" title="${escapeHtml(file.name||'')}">${escapeHtml(file.name||'-')}</div>
                <div class="file-meta">${formatSize(file.size||0)} · ${formatDateShort(file.created_at)}</div>
            </div>`;
        grid.appendChild(card);
    });
}

function buildKebabMenu(file) {
    const previewBtn = canPreview(file.name, file.part_count)
        ? `<button data-action="preview" data-id="${file.id}">👁 Xem trước</button>` : "";
    return `
    <div class="action-menu" data-menu-for="${file.id}">
        ${previewBtn}
        <button data-action="details"  data-id="${file.id}">ℹ️ Chi tiết</button>
        <button data-action="download" data-id="${file.id}">⬇️ Tải xuống</button>
        <div class="menu-separator"></div>
        <button data-action="delete" data-id="${file.id}" class="danger">🗑 Xóa tệp</button>
    </div>`;
}

// ============================================================
// SEARCH
// ============================================================
if (searchInput) searchInput.addEventListener("input", renderFiles);

// ============================================================
// KEBAB MENU + CONTEXT MENU DELEGATION
// ============================================================
document.addEventListener("click", e => {
    const dotsBtn = e.target.closest(".action-dots");

    // Close all open menus unless clicking the same kebab
    document.querySelectorAll(".action-menu.open").forEach(m => {
        if (!dotsBtn || m.dataset.menuFor !== dotsBtn.dataset.id) {
            m.classList.remove("open");
        }
    });

    if (dotsBtn) {
        e.stopPropagation();
        const menu = document.querySelector(`.action-menu[data-menu-for="${dotsBtn.dataset.id}"]`);
        if (menu) menu.classList.toggle("open");
        return;
    }

    const actionBtn = e.target.closest(".action-menu button");
    if (actionBtn) {
        actionBtn.closest(".action-menu")?.classList.remove("open");
        const id     = actionBtn.dataset.id;
        const action = actionBtn.dataset.action;
        if (action === "preview")  previewFile(id);
        if (action === "details")  showDetails(id);
        if (action === "download") downloadFile(id);
        if (action === "delete")   deleteFile(id);
    }
});

// ============================================================
// BULK ACTIONS
// ============================================================
function updateSelectCount() {
    const checked = dataScroller ? [...dataScroller.querySelectorAll(".row-check:checked")] : [];
    if (selectCountEl) selectCountEl.textContent = checked.length;
    if (bulkActionsBar) bulkActionsBar.style.display = checked.length > 0 ? "flex" : "none";
}

if (btnBulkDelete) {                            // ← #btn-bulk-delete (khớp HTML)
    btnBulkDelete.addEventListener("click", async () => {
        const checked = [...(dataScroller?.querySelectorAll(".row-check:checked") || [])];
        if (checked.length === 0) return;
        if (!confirm(`Xóa ${checked.length} tệp tin đã chọn? Thao tác này không thể hoàn tác!`)) return;

        showToast(`Đang xóa ${checked.length} tệp...`, "warning");
        let success = 0;
        for (const cb of checked) {
            const ok = await deleteFileSilent(cb.dataset.id);
            if (ok) success++;
        }
        showToast(`Đã xóa ${success}/${checked.length} tệp.`, "success");
        loadFiles();
    });
}

if (btnDeselectAll) {
    btnDeselectAll.addEventListener("click", () => {
        if (dataScroller) {
            dataScroller.querySelectorAll(".row-check").forEach(cb => cb.checked = false);
            const all = document.getElementById("select-all");
            if (all) all.checked = false;
        }
        updateSelectCount();
    });
}

if (btnClearAll) {                              // ← #btn-clear-all (khớp HTML)
    btnClearAll.addEventListener("click", async () => {
        if (allFiles.length === 0) { showToast("Kho lưu trữ đang trống!", "info"); return; }
        if (!confirm(`⚠️ NGUY HIỂM: Xóa TOÀN BỘ ${allFiles.length} tệp? Không thể hoàn tác!`)) return;

        showToast("Đang xóa toàn bộ kho dữ liệu...", "danger", 0);
        let ok = 0;
        for (const f of allFiles.slice()) {
            if (await deleteFileSilent(f.id)) ok++;
        }
        // Close the persistent toast, show result
        document.querySelectorAll(".toast-msg").forEach(t => t.remove());
        showToast(`Đã xóa sạch ${ok} tệp.`, "success");
        loadFiles();
    });
}

// ============================================================
// DELETE
// ============================================================
async function deleteFileSilent(id) {
    addLog(`[Xóa] ID: ${id}`);
    try {
        const res = await fetchWithRetry(`${API}/file/${id}`, {
            method: "DELETE",
            headers: { Authorization: AUTH_HEADER }
        });
        if (res.ok) { addLog(`[Xóa] ✓ ${id}`); return true; }
        addLog(`[Xóa] ✗ HTTP ${res.status}`);
        return false;
    } catch (err) {
        addLog(`[Xóa] ✗ ${err.message}`);
        return false;
    }
}

async function deleteFile(id) {
    const file = allFiles.find(f => f.id === id);
    if (!confirm(`Xóa tệp "${escapeHtml(file?.name||id)}"? Thao tác này không thể hoàn tác!`)) return;
    showToast("Đang xóa tệp...", "info");
    const ok = await deleteFileSilent(id);
    if (ok) showToast("Xóa tệp thành công!", "success");
    else    showToast("Xóa thất bại. Vui lòng thử lại.", "danger");
    loadFiles();
}

// ============================================================
// DETAILS
// ============================================================
async function showDetails(id) {
    try {
        const res  = await fetchWithRetry(`${API}/file/${id}`, { headers:{ Authorization: AUTH_HEADER } });
        const file = await res.json();
        if (detailsPanel)  detailsPanel.style.display = "block";
        if (detailIdEl)    detailIdEl.textContent    = "ID: " + (file.id||"-");
        if (detailNameEl)  detailNameEl.textContent  = "Tên: " + (file.name||"-");
        if (detailSizeEl)  detailSizeEl.textContent  = "Dung lượng: " + formatSize(file.size||0);
        if (detailPartsEl) detailPartsEl.textContent = "Số mảnh: " + (file.part_count||1);
        if (detailStatusEl)detailStatusEl.textContent= "Trạng thái: " + (file.status||"-");

        if (partTableBody) {
            partTableBody.innerHTML = "";
            (file.parts||[]).forEach(p => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td>${p.index}</td><td>${escapeHtml(p.name||'-')}</td>
                    <td style="font-size:11px;word-break:break-all;">${p.file_id||'-'}</td>
                    <td>${p.message_id||'-'}</td>`;
                partTableBody.appendChild(tr);
            });
        }
        if (detailsPanel) detailsPanel.scrollIntoView({ behavior:"smooth", block:"nearest" });
    } catch (err) {
        showToast("Lỗi khi lấy chi tiết tệp!", "danger");
    }
}

// ============================================================
// PREVIEW
// ============================================================
function canPreview(filename, partCount) {
    const ext = getExt(filename);
    const previewable = [...EXT_IMAGE, ...EXT_VIDEO, ...EXT_AUDIO, ...EXT_PDF].includes(ext);
    return previewable && (partCount||1) === 1;
}

async function previewFile(id) {
    if (!previewModal) return;
    if (previewTitle) previewTitle.textContent = "Đang tải...";
    if (previewBody)  previewBody.innerHTML    = `<p style="color:var(--muted);text-align:center;">Đang tải dữ liệu...</p>`;
    previewModal.style.display = "flex";

    try {
        const res  = await fetchWithRetry(`${API}/file/${id}`, { headers:{ Authorization: AUTH_HEADER } });
        const file = await res.json();
        if (previewTitle) previewTitle.textContent = file.name || "Xem trước";

        if (!file.parts || file.parts.length !== 1) {
            if (previewBody) previewBody.innerHTML = `<p style="color:var(--muted);">File nhiều mảnh không hỗ trợ xem trực tiếp.</p>`;
            return;
        }

        const part    = file.parts[0];
        const ext     = getExt(file.name);
        const dlRes   = await fetchWithRetry(`${API}/download/${part.file_id}`, { headers:{ Authorization: AUTH_HEADER } });
        if (!dlRes.ok) throw new Error("Không tải được dữ liệu xem trước.");
        const blob    = await dlRes.blob();
        const objUrl  = URL.createObjectURL(blob);

        if (EXT_IMAGE.includes(ext)) {
            previewBody.innerHTML = `<img src="${objUrl}" alt="${escapeHtml(file.name)}">`;
        } else if (EXT_VIDEO.includes(ext)) {
            previewBody.innerHTML = `<video src="${objUrl}" controls autoplay style="width:100%;max-height:64vh;"></video>`;
        } else if (EXT_AUDIO.includes(ext)) {
            previewBody.innerHTML = `<audio src="${objUrl}" controls autoplay></audio>`;
        } else if (EXT_PDF.includes(ext)) {
            const pdfBlob = new Blob([blob], { type:"application/pdf" });
            const pdfUrl  = URL.createObjectURL(pdfBlob);
            previewBody.innerHTML = `<iframe src="${pdfUrl}" style="width:100%;height:66vh;border:none;"></iframe>`;
        } else {
            previewBody.innerHTML = `<p style="color:var(--muted);">Không hỗ trợ xem trước định dạng này.</p>`;
        }
    } catch (err) {
        if (previewBody) previewBody.innerHTML = `<p style="color:var(--muted);">Lỗi tải xem trước: ${escapeHtml(err.message)}</p>`;
    }
}

window.closePreview = function() {
    if (!previewModal) return;
    previewModal.style.display = "none";
    if (previewBody) {
        const media = previewBody.querySelector("img,video,audio,iframe");
        if (media?.src?.startsWith("blob:")) URL.revokeObjectURL(media.src);
        previewBody.innerHTML = "";
    }
};
if (previewModal) {
    previewModal.addEventListener("click", e => { if (e.target === previewModal) closePreview(); });
}

// ============================================================
// DOWNLOAD (StreamSaver – Không ngốn RAM)
// ============================================================
async function downloadFile(id) {
    let fileMeta;
    try {
        const res = await fetchWithRetry(`${API}/file/${id}`, { headers:{ Authorization: AUTH_HEADER } });
        fileMeta  = await res.json();
    } catch (err) {
        showToast("Không lấy được thông tin tệp!", "danger"); return;
    }

    if (!fileMeta?.parts?.length) {
        showToast("Tệp không có dữ liệu để tải!", "danger"); return;
    }

    const parts       = fileMeta.parts.slice().sort((a,b) => a.index - b.index);
    const totalBytes  = Number(fileMeta.size || 0);

    // StreamSaver setup
    const fileStream  = streamSaver.createWriteStream(
        fileMeta.name || "download.bin",
        totalBytes > 0 ? { size: totalBytes } : {}
    );
    const writer = fileStream.getWriter ? fileStream.getWriter() : fileStream.WriteStream.getWriter();

    showMiniPanel("download");
    activeDownload = true;
    if (downloadFileName) downloadFileName.textContent = fileMeta.name || id;
    if (downloadBar)      downloadBar.style.width      = "0%";
    if (downloadStatusEl) downloadStatusEl.textContent = "0%";

    addLog(`[Download] Bắt đầu: ${fileMeta.name} | ${parts.length} parts`);
    showToast(`Đang tải: ${fileMeta.name}`, "info", 3000);

    let downloaded = 0;
    try {
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const res  = await fetchWithRetry(`${API}/download/${part.file_id}`, {
                headers: { Authorization: AUTH_HEADER }
            });
            if (!res.ok || !res.body) throw new Error(`Part ${i+1}: lỗi luồng ${res.status}`);

            const reader = res.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
                downloaded += value.length;
                if (totalBytes > 0) {
                    const pct = Math.min(100, Math.round((downloaded / totalBytes) * 100));
                    if (downloadBar)      downloadBar.style.width      = pct + "%";
                    if (downloadStatusEl) downloadStatusEl.textContent = `${pct}%`;
                }
            }
            addLog(`[Download] Part ${i+1}/${parts.length} ✓`);
        }

        await writer.close();
        if (downloadBar)      downloadBar.style.width      = "100%";
        if (downloadStatusEl) downloadStatusEl.textContent = "✅ Xong";
        showToast(`Tải xuống hoàn tất: ${fileMeta.name}`, "success");
        addLog(`[Download] Hoàn tất: ${fileMeta.name}`);
        setTimeout(() => hideMiniPanel("download"), 2500);

    } catch (err) {
        console.error(err);
        if (downloadStatusEl) downloadStatusEl.textContent = "❌ Lỗi";
        showToast(`Tải xuống thất bại: ${err.message}`, "danger");
        addLog(`[Download] ✗ ${err.message}`);
        try { await writer.abort(); } catch (_) {}
    } finally {
        activeDownload = false;
    }
}

// ============================================================
// UTILITIES
// ============================================================
function addLog(text) {
    if (!logList) return;
    const li = document.createElement("li");
    li.style.listStyle = "none";
    li.textContent = `[${new Date().toLocaleTimeString("vi-VN")}] ${text}`;
    logList.prepend(li);
    // Keep log to 100 items
    while (logList.children.length > 100) logList.removeChild(logList.lastChild);
}

function formatSize(bytes) {
    bytes = Number(bytes||0);
    if (bytes < 1024)              return bytes + " B";
    if (bytes < 1024*1024)         return (bytes/1024).toFixed(1) + " KB";
    if (bytes < 1024*1024*1024)    return (bytes/1024/1024).toFixed(2) + " MB";
    return (bytes/1024/1024/1024).toFixed(2) + " GB";
}

function formatDate(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleString("vi-VN");
}

function formatDateShort(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleDateString("vi-VN");
}

function getExt(name) {
    const dot = (name||"").lastIndexOf(".");
    if (dot === -1) return "";
    return name.slice(dot+1).toLowerCase().replace(/\.part\d+$/, "");
}

function getIconInfo(filename) {
    const ext = getExt(filename);
    if (EXT_IMAGE.includes(ext))   return { emoji:"🖼", cls:"icon-image" };
    if (EXT_VIDEO.includes(ext))   return { emoji:"🎬", cls:"icon-video" };
    if (EXT_AUDIO.includes(ext))   return { emoji:"🎵", cls:"icon-audio" };
    if (EXT_PDF.includes(ext))     return { emoji:"📄", cls:"icon-doc" };
    if (EXT_DOC.includes(ext))     return { emoji:"📝", cls:"icon-doc" };
    if (EXT_ARCHIVE.includes(ext)) return { emoji:"📦", cls:"icon-archive" };
    return { emoji:"🗂", cls:"" };
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;");
}
