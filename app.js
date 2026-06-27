/**
 * TG-Drive Frontend Logic - PRO V4 (Khờp cấu trúc Glassmorphism & Liquid Design)
 * -----------------------------------------------------------------
 * - Đăng nhập bằng mật khẩu tĩnh (lưu LocalStorage)
 * - Upload: cắt file 45MB, đẩy tuần tự (UPLOAD_CONCURRENCY luồng), IndexedDB resume.
 * - Download: StreamSaver tuần tự không ngốn RAM.
 * - Xóa file lớn: bóc tách xóa từng part từ Frontend.
 * - UI Pro: search, sort cột, checkbox + bulk delete, clear-all, kebab menu (...),
 * modal preview (ảnh / video / audio / pdf).
 * - Bổ sung: Hệ thống đa góc nhìn (Grid/List), Toast cao cấp, phân vùng Icon động.
 */

// =========================================================
// TIÊM HIỆU ỨNG CHUYỂN ĐỘNG CHO NÚT & BANNER TRỰC QUAN
// =========================================================
(function injectButtonMotionCSS() {
    const style = document.createElement('style');
    style.innerHTML = `
        .btn, button {
            position: relative;
            overflow: hidden;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            transform: scale(1);
            cursor: pointer;
        }
        .btn:hover, button:hover {
            transform: translateY(-2px) scale(1.02);
            box-shadow: 0 8px 20px rgba(139, 92, 246, 0.3);
            filter: brightness(1.15);
        }
        .btn:active, button:active {
            transform: translateY(1px) scale(0.97) !important;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .btn-pulse-active {
            animation: btnPulseEffect 1.5s infinite ease-in-out;
        }
        @keyframes btnPulseEffect {
            0% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.6); }
            70% { box-shadow: 0 0 0 12px rgba(139, 92, 246, 0); }
            100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
        }
        .btn-danger:hover {
            background: linear-gradient(135deg, #ef4444, #b91c1c) !important;
            animation: shakeDangerBtn 0.3s ease-in-out 1;
        }
        @keyframes shakeDangerBtn {
            0%, 100% { transform: translateX(0) translateY(-2px); }
            25% { transform: translateX(-3px) translateY(-2px); }
            75% { transform: translateX(3px) translateY(-2px); }
        }
        .action-cell { position: relative; }
        .action-menu {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            min-width: 180px;
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 12px;
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            box-shadow: 0 12px 32px rgba(0,0,0,0.5);
            z-index: 150;
            display: none;
            flex-direction: column;
            overflow: hidden;
            padding: 6px;
        }
        .action-menu.open { display: flex; animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1); }
        .action-menu button {
            background: transparent;
            border: none;
            color: #e2e8f0;
            text-align: left;
            padding: 10px 14px;
            font-size: 13.5px;
            font-weight: 500;
            border-radius: 6px;
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .action-menu button:hover {
            background: rgba(139, 92, 246, 0.2);
            color: #fff;
            transform: none;
            box-shadow: none;
            filter: none;
        }
        .action-menu button.danger { color: #fca5a5; }
        .action-menu button.danger:hover { background: rgba(244, 63, 94, 0.2); color: #fff; }
    `;
    document.head.appendChild(style);
})();

const PASSWORD = "140613";
const API = "https://drive-worker.phamdatt140613.workers.dev";
const AUTH_HEADER = "140613";

const DEFAULT_PART_SIZE = 45 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 1;

const PREVIEW_IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
const PREVIEW_VIDEO_EXT = ["mp4", "webm", "ogg", "mov"];
const PREVIEW_AUDIO_EXT = ["mp3", "wav", "m4a", "aac"];
const PREVIEW_PDF_EXT = ["pdf"];

// =========================================================
// DOM REFERENCES (HỖ TRỢ CẢ LỚP CŨ VÀ CẤU TRÚC GLASS NEW)
// =========================================================
const loginPage = document.getElementById("login-page");
const dashboard = document.getElementById("dashboard");
const loginForm = document.querySelector(".login-form");
const passwordInput = document.querySelector(".password-input");
const uploadBtn = document.getElementById("btn-upload-trigger");
const uploadInput = document.getElementById("file-input");
const partSizeSelect = null; // removed from UI - hardcoded 45MB
const logoutBtn = document.querySelector(".logout-btn");
const totalFiles = document.querySelector(".total-files");
const totalSize = document.querySelector(".total-size");
const usedSize = document.getElementById("storage-used-text");

// View toggles
const dataViewScroller = document.querySelector(".data-view-scroller");
const btnToggleList = document.getElementById("view-list-toggle");
const btnToggleGrid = document.getElementById("view-grid-toggle");
const storageProgressFill = document.querySelector(".storage-progress-fill");

// Panels Tiến trình — dùng đúng id theo index.html hiện tại
// Upload và Download đều dùng chung #download-manager-panel (mini-progress-panel)
const uploadManagerPanel   = document.getElementById("download-manager-panel");
const uploadingFileName    = document.getElementById("progress-file-name");
const uploadProgressBar    = document.getElementById("download-progress-bar");  // liquid bar, dùng chung
const uploadProgressText   = document.getElementById("progress-speed");
const managerUploadBar     = document.getElementById("download-progress-bar");
const uploadStatus         = document.getElementById("download-status");
const currentPartText      = document.getElementById("progress-parts-count");
const uploadControls       = document.querySelector(".process-controls-row");
const btnPause             = document.getElementById("btn-process-pause");
const btnResume            = document.getElementById("btn-process-resume");

const downloadManagerPanel = document.getElementById("download-manager-panel");
const downloadingFileName  = document.getElementById("progress-file-name");
const downloadProgressBar  = document.getElementById("download-progress-bar");
const downloadStatus       = document.getElementById("download-status");

// Details drawer
const detailsPanel = document.getElementById("file-details-section");
const detailId     = document.querySelector(".detail-id");
const detailName   = document.querySelector(".detail-name");
const detailSize   = document.querySelector(".detail-size");
const detailParts  = document.querySelector(".detail-parts");
const detailStatus = document.querySelector(".detail-status");
const partTableBody = document.querySelector(".part-table-body");

const logList        = document.querySelector(".log-list");
const searchInput    = document.getElementById("search-input");
const bulkDeleteBtn  = document.getElementById("btn-bulk-delete");
const selectCountSpan = document.querySelector(".selected-count");
const clearAllBtn    = document.getElementById("btn-clear-all");

const previewModal = document.getElementById("preview-modal");
const previewTitle = document.getElementById("preview-title");
const previewBody  = document.getElementById("preview-body");

// =========================================================
// STATE MANAGEMENT (BỔ SUNG CHẾ ĐỘ VIEW)
// =========================================================
let allFiles = [];
let sortKey = null;
let sortDir = 1; 
let currentView = localStorage.getItem("tgdrive_view_pref") || "list"; // Mặc định góc nhìn danh sách hoặc lưới

let uploadState = {
    file: null,
    fileId: "",
    partSize: DEFAULT_PART_SIZE,
    totalParts: 0,
    currentPart: 1,
    paused: false,
    cancelled: false,
    sessionKey: ""
};

init();

// =========================================================
// INIT / AUTH & TOASTS SYSTEM
// =========================================================
async function init() {
    await openDB();
    setupViewToggles();
    if (localStorage.getItem("drive_auth") === "1") {
        showDashboard();
    } else {
        showLogin();
    }
    checkPendingUpload();
}

function showToast(message, type = "info") {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "toast-msg";
    
    let colorBorder = "var(--accent-violet)";
    if (type === "success") colorBorder = "var(--accent-emerald)";
    if (type === "danger" || type === "error") colorBorder = "var(--accent-rose)";
    if (type === "warning") colorBorder = "var(--accent-amber)";
    
    toast.style.borderLeftColor = colorBorder;
    toast.innerHTML = `<span>⚡</span> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(-30px)";
        toast.style.transition = "all 0.4s ease";
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

function setupViewToggles() {
    if (btnToggleList && btnToggleGrid) {
        btnToggleList.classList.toggle("active", currentView === "list");
        btnToggleGrid.classList.toggle("active", currentView === "grid");

        btnToggleList.addEventListener("click", () => {
            currentView = "list";
            localStorage.setItem("tgdrive_view_pref", "list");
            btnToggleList.classList.add("active");
            btnToggleGrid.classList.remove("active");
            const listView = document.getElementById("file-list-view");
            const gridView = document.getElementById("file-grid-view");
            if (listView) listView.style.display = "";
            if (gridView) gridView.style.display = "none";
            renderFiles();
        });

        btnToggleGrid.addEventListener("click", () => {
            currentView = "grid";
            localStorage.setItem("tgdrive_view_pref", "grid");
            btnToggleGrid.classList.add("active");
            btnToggleList.classList.remove("active");
            const listView = document.getElementById("file-list-view");
            const gridView = document.getElementById("file-grid-view");
            if (listView) listView.style.display = "none";
            if (gridView) gridView.style.display = "";
            renderFiles();
        });
    }
}

function showLogin() {
    if (loginPage) loginPage.style.display = "flex";
    if (dashboard) dashboard.style.display = "none";
}

function showDashboard() {
    if (loginPage) loginPage.style.display = "none";
    if (dashboard) dashboard.style.display = "flex";
    loadFiles();
}

if (loginForm) {
    loginForm.addEventListener("submit", e => {
        e.preventDefault();
        if (!passwordInput) return;
        const pass = passwordInput.value.trim();
        if (pass === PASSWORD) {
            localStorage.setItem("drive_auth", "1");
            showToast("Đăng nhập kho lưu trữ cấu trúc thành công!", "success");
            showDashboard();
        } else {
            showToast("Mật khẩu truy cập hệ thống không chính xác!", "danger");
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("drive_auth");
        location.reload();
    });
}

// =========================================================
// INDEXEDDB RESUME STORAGE LOCKER
// =========================================================
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("tgdrive_db", 1);
        request.onupgradeneeded = () => {
            const idb = request.result;
            if (!idb.objectStoreNames.contains("upload_progress")) {
                idb.createObjectStore("upload_progress", { keyPath: "sessionKey" });
            }
        };
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onerror = () => reject(request.error);
    });
}

function dbPut(storeName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbGetAllKeys(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function checkPendingUpload() {
    if (!db) return;
    const keys = await dbGetAllKeys("upload_progress");
    if (keys.length > 0) {
        addLog(`Hệ thống: Phát hiện thấy ${keys.length} tệp tin gián đoạn. Hãy chọn lại tệp gốc để Resume dữ liệu.`);
        showToast("Có tiến trình tải lên chưa hoàn tất cần khôi phục!", "warning");
    }
}

// =========================================================
// UPLOAD PIPELINE
// =========================================================
if (uploadInput) {
    uploadInput.addEventListener("change", () => {
        if (uploadState.file && !uploadState.paused && !uploadState.cancelled) {
            return;
        }
        startUpload();
    });
}
// ĐOẠN VIẾT TIẾP CHO: Kích hoạt hộp thoại chọn file khi bấm nút "Tải lên mới"
if (uploadBtn && uploadInput) {
    uploadBtn.addEventListener("click", (e) => {
        e.preventDefault();
        uploadInput.click();
    });
}

if (btnPause) {
    btnPause.addEventListener("click", () => {
        uploadState.paused = true;
        if (uploadBtn) uploadBtn.classList.remove("btn-pulse-active");
        if (uploadStatus) uploadStatus.textContent = `Đã tạm dừng`;
        if (btnResume) btnResume.style.display = "inline-block";
        btnPause.style.display = "none";
        addLog("Hành động: Tạm ngừng tiến trình đẩy part file.");
        showToast("Đã tạm dừng tải tệp tin lên.", "warning");
    });
}

if (btnResume) {
    btnResume.addEventListener("click", () => {
        if (!uploadState.file) {
            showToast("Vui lòng chọn lại tệp tin gốc để tiếp tục chuỗi khối!", "danger");
            return;
        }
        if (!uploadState.paused) return;
        uploadState.paused = false;
        if (uploadBtn) uploadBtn.classList.add("btn-pulse-active");
        btnResume.style.display = "none";
        if (btnPause) btnPause.style.display = "inline-block";
        addLog("Hành động: Tiếp tục đồng bộ part file.");
        runUploadLoop();
    });
}

async function startUpload() {
    const file = uploadInput.files[0];
    if (!file) return;

    const partSizeMB = Number(partSizeSelect ? partSizeSelect.value : 45);
    const partSize = partSizeMB * 1024 * 1024;
    const sessionKey = `${file.name}_${file.size}`;

    let progress = await dbGet("upload_progress", sessionKey);
    const totalParts = Math.ceil(file.size / partSize);

    if (progress && progress.totalParts === totalParts) {
        showToast("Đang kết nối lại chuỗi mảnh tệp tin...", "info");
        addLog(`Hệ thống phục hồi: Tiếp tục đồng bộ mảnh ${progress.doneParts.length}/${totalParts}.`);
    } else {
        progress = {
            sessionKey,
            fileId: "",
            partSize,
            totalParts,
            doneParts: [],
            name: file.name,
            size: file.size,
            mimeType: file.type || "application/octet-stream"
        };
        await dbPut("upload_progress", progress);
    }

    uploadState = {
        file,
        fileId: progress.fileId || "",
        partSize: progress.partSize,
        totalParts: progress.totalParts,
        currentPart: progress.doneParts.length,
        paused: false,
        cancelled: false,
        sessionKey
    };

    if (uploadManagerPanel) uploadManagerPanel.style.display = "block";
    if (uploadingFileName) uploadingFileName.textContent = file.name;

    if (uploadControls) uploadControls.style.display = "flex";
    if (btnResume) btnResume.style.display = "none";
    if (btnPause) btnPause.style.display = "inline-block";
    if (uploadBtn) uploadBtn.classList.add("btn-pulse-active");

    addLog("Khởi động: Upload luồng " + file.name);
    runUploadLoop();
}

async function runUploadLoop() {
    const progress = await dbGet("upload_progress", uploadState.sessionKey);
    if (!progress) return;

    const { file, partSize, totalParts } = uploadState;
    const pendingPartsQueue = [];
    for (let i = 1; i <= totalParts; i++) {
        if (!progress.doneParts.includes(i)) {
            pendingPartsQueue.push(i);
        }
    }

    updateUploadUI(progress.doneParts.length, totalParts);

    const uploadWorker = async () => {
        while (pendingPartsQueue.length > 0) {
            if (uploadState.paused || uploadState.cancelled) return;

            const partIndex = pendingPartsQueue.shift();
            if (partIndex === undefined) break;

            const start = (partIndex - 1) * partSize;
            const end = Math.min(start + partSize, file.size);
            const chunkBlob = file.slice(start, end);

            try {
                const result = await uploadPart(chunkBlob, {
                    fileId: uploadState.fileId,
                    fileName: file.name,
                    fileSize: file.size,
                    partIndex,
                    totalParts,
                    mimeType: progress.mimeType
                });

                if (!uploadState.fileId && result.id) {
                    uploadState.fileId = result.id;
                    progress.fileId = result.id;
                }

                const liveProgress = await dbGet("upload_progress", uploadState.sessionKey);
                if (liveProgress) {
                    if (!liveProgress.doneParts.includes(partIndex)) {
                        liveProgress.doneParts.push(partIndex);
                        liveProgress.doneParts.sort((a, b) => a - b);
                    }
                    if (uploadState.fileId) liveProgress.fileId = uploadState.fileId;
                    await dbPut("upload_progress", liveProgress);
                    progress.doneParts = liveProgress.doneParts;
                    uploadState.currentPart = liveProgress.doneParts.length;
                }

                addLog(`Thành công: Đã tải dữ liệu phần ${partIndex}/${totalParts}`);
                updateUploadUI(progress.doneParts.length, totalParts);

            } catch (err) {
                console.error(err);
                pendingPartsQueue.unshift(partIndex);
                if (uploadStatus) uploadStatus.textContent = `Lỗi phân mảnh ${partIndex}`;
                showToast(`Gián đoạn luồng phần số ${partIndex}`, "danger");

                uploadState.paused = true;
                if (btnResume) btnResume.style.display = "inline-block";
                if (btnPause) btnPause.style.display = "none";
                if (uploadBtn) uploadBtn.classList.remove("btn-pulse-active");
                return;
            }
        }
    };

    const activeWorkers = [];
    const executionThreads = Math.min(UPLOAD_CONCURRENCY, pendingPartsQueue.length);
    for (let w = 0; w < executionThreads; w++) {
        activeWorkers.push(uploadWorker());
    }

    await Promise.all(activeWorkers);

    const finalCheck = await dbGet("upload_progress", uploadState.sessionKey);
    if (!uploadState.paused && !uploadState.cancelled && finalCheck && finalCheck.doneParts.length === totalParts) {
        if (uploadProgressBar) uploadProgressBar.style.width = "100%";
        if (managerUploadBar) managerUploadBar.style.width = "100%";
        if (uploadProgressText) uploadProgressText.textContent = "100%";
        if (uploadStatus) uploadStatus.textContent = "Hoàn tất dữ liệu";
        
        showToast("Tải tệp tin lên hoàn tất!", "success");

        if (uploadControls) uploadControls.style.display = "none";
        if (uploadBtn) uploadBtn.classList.remove("btn-pulse-active");

        await dbDelete("upload_progress", uploadState.sessionKey);
        addLog("Đồng bộ hoàn thành: " + uploadState.file.name);

        setTimeout(() => {
            if (uploadManagerPanel) uploadManagerPanel.style.display = "none";
        }, 1500);

        uploadInput.value = "";
        loadFiles();
    }
}

async function uploadPart(blob, meta) {
    const form = new FormData();
    form.append("file", new File([blob], `${meta.fileName}.part${meta.partIndex}`, { type: meta.mimeType || "application/octet-stream" }));
    form.append("original_name", meta.fileName);
    form.append("original_size", String(meta.fileSize));
    form.append("part_index", String(meta.partIndex));
    form.append("part_count", String(meta.totalParts));
    form.append("mime_type", meta.mimeType || "application/octet-stream");
    form.append("file_id", meta.fileId || "");

    const response = await fetch(API + "/upload", {
        method: "POST",
        headers: { Authorization: AUTH_HEADER },
        body: form
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
    }
    return response.json();
}

function updateUploadUI(doneCount, totalParts) {
    const percent = Math.round((doneCount / totalParts) * 100);

    if (uploadProgressBar)
        uploadProgressBar.style.width = percent + "%";

    if (managerUploadBar)
        managerUploadBar.style.width = percent + "%";

    if (uploadProgressText)
        uploadProgressText.textContent = percent + "%";

    if (uploadStatus)
        uploadStatus.textContent =
            `Đang đẩy song song: đã xong ${doneCount}/${totalParts} part (${percent}%)`;

    if (currentPartText)
        currentPartText.textContent =
            `Part: ${doneCount}/${totalParts}`;
}
// =========================================================
// LOAD DATABANK FILES
// =========================================================
async function loadFiles() {
    try {
        const response = await fetch(API + "/files", { headers: { "Authorization": AUTH_HEADER } });
        console.log("status", response.status);

const files = await response.json();

console.log("files", files);
        if (!Array.isArray(files)) { console.error(files); return; }
        allFiles = files;
        renderFiles();
    } catch (error) {
        console.error(error);
        showToast("Không thể nạp cấu trúc cây thư mục!", "danger");
    }
}

// =========================================================
// XỬ LÝ ĐUÔI TỆP & THIẾT KẾ ICON THỊ GIÁC CAO CẤP
// =========================================================
function getExt(name) {
    const dot = (name || "").lastIndexOf(".");
    if (dot === -1) return "";
    return name.slice(dot + 1).toLowerCase().split(".part")[0];
}

function getVisualIconInfo(filename) {
    const ext = getExt(filename);
    if (PREVIEW_IMAGE_EXT.includes(ext)) return { icon: "🔮", class: "icon-image" };
    if (PREVIEW_VIDEO_EXT.includes(ext)) return { icon: "🎬", class: "icon-video" };
    if (PREVIEW_AUDIO_EXT.includes(ext)) return { icon: "🎵", class: "icon-audio" };
    if (PREVIEW_PDF_EXT.includes(ext))   return { icon: "📄", class: "icon-doc" };
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { icon: "📦", class: "icon-archive" };
    return { icon: "🗂", class: "" };
}

// =========================================================
// SEARCH + SORT + THAY THẾ GÓC NHÌN ĐA NHIỆM (LIST/GRID)
// =========================================================
if (searchInput) {
    searchInput.addEventListener("input", renderFiles);
}

window.sortTable = function(colIndex) {
    const keyMap = { 1: "name", 2: "size", 3: "created_at" };
    const key = keyMap[colIndex];
    if (!key) return;
    if (sortKey === key) {
        sortDir = -sortDir;
    } else {
        sortKey = key;
        sortDir = 1;
    }
    renderFiles();
};

function getFilteredSortedFiles() {
    let files = allFiles.slice();
    const keyword = (searchInput && searchInput.value || "").trim().toLowerCase();
    if (keyword) {
        files = files.filter(f => (f.name || "").toLowerCase().includes(keyword));
    }
    if (sortKey) {
        files.sort((a, b) => {
            let va = a[sortKey]; let vb = b[sortKey];
            if (sortKey === "name") {
                va = (va || "").toLowerCase(); vb = (vb || "").toLowerCase();
                return va.localeCompare(vb) * sortDir;
            }
            va = Number(va || 0); vb = Number(vb || 0);
            return (va - vb) * sortDir;
        });
    }
    return files;
}

function renderFiles() {
    const files = getFilteredSortedFiles();

    let totalBytes = 0;
    allFiles.forEach(f => totalBytes += Number(f.size || 0));

    if (totalFiles) totalFiles.textContent = allFiles.length;
    if (totalSize) totalSize.textContent = formatSize(totalBytes);
    if (usedSize) usedSize.textContent = `Đang dùng: ${formatSize(totalBytes)}`;

    const storagePercent = Math.min(100, Math.max(2, (totalBytes / (100 * 1024 * 1024 * 1024)) * 100));
    if (storageProgressFill) storageProgressFill.style.width = storagePercent + "%";

    const emptyState = document.getElementById("empty-state-view");
    const listView   = document.getElementById("file-list-view");
    const gridView   = document.getElementById("file-grid-view");
    const tableBody  = document.getElementById("main-files-table-body");

    if (files.length === 0) {
        if (emptyState) emptyState.style.display = "flex";
        if (listView)   listView.style.display   = "none";
        if (gridView)   gridView.style.display   = "none";
        updateSelectCount();
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    if (currentView === "list") {
        if (listView) listView.style.display   = "";
        if (gridView) gridView.style.display   = "none";

        if (!tableBody) return;
        tableBody.innerHTML = "";

        files.forEach((file, idx) => {
            const tr = document.createElement("tr");
            tr.dataset.id = file.id;
            const iconInfo = getVisualIconInfo(file.name);

            tr.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="row-check custom-checkbox" data-id="${file.id}"></td>
            <td style="text-align:center;" class="stt-cell">${idx + 1}</td>
            <td>
                <div class="file-name-cell" title="${escapeHtml(file.name || "")}">
                    <div class="file-icon-box ${iconInfo.class}">${iconInfo.icon}</div>
                    <span class="file-name-text">${escapeHtml(file.name || "-")}</span>
                </div>
            </td>
            <td>${formatSize(file.size || 0)}</td>
            <td>${formatDate(file.created_at)}</td>
            <td class="action-cell" style="text-align:center;">
                <button class="kebab-btn action-dots" data-id="${file.id}">&#8942;</button>
                <div class="action-menu" data-menu-for="${file.id}">
                    ${canPreviewFile(file) ? `<button data-action="preview" data-id="${file.id}">👁 Xem trước</button>` : ""}
                    <button data-action="details" data-id="${file.id}">ℹ Chi tiết</button>
                    <button data-action="download" data-id="${file.id}">⬇ Tải tệp</button>
                    <button class="danger" data-action="delete" data-id="${file.id}">🗑 Xóa bỏ</button>
                </div>
            </td>
            `;
            tableBody.appendChild(tr);
        });

        // select-all nằm trong thead tĩnh
        const selectAllCb = document.getElementById("th-check-all");
        if (selectAllCb) {
            // clone để xóa listener cũ, tránh gắn nhiều lần
            const fresh = selectAllCb.cloneNode(true);
            selectAllCb.replaceWith(fresh);
            fresh.addEventListener("change", () => {
                tableBody.querySelectorAll(".row-check").forEach(cb => cb.checked = fresh.checked);
                updateSelectCount();
            });
        }

    } else {
        // GRID VIEW
        if (listView) listView.style.display = "none";
        if (gridView) {
            gridView.style.display = "";
            gridView.innerHTML = "";

            files.forEach(file => {
                const iconInfo = getVisualIconInfo(file.name);
                const card = document.createElement("div");
                card.className = "grid-card glass-panel";
                card.dataset.id = file.id;

                card.innerHTML = `
                    <div class="grid-card-header">
                        <input type="checkbox" class="row-check custom-checkbox" data-id="${file.id}">
                        <div class="action-cell">
                            <button class="kebab-btn action-dots" data-id="${file.id}">&#8942;</button>
                            <div class="action-menu" data-menu-for="${file.id}">
                                ${canPreviewFile(file) ? `<button data-action="preview" data-id="${file.id}">👁 Xem trực quan</button>` : ""}
                                <button data-action="details" data-id="${file.id}">ℹ Cấu trúc</button>
                                <button data-action="download" data-id="${file.id}">⬇ Tải về</button>
                                <button class="danger" data-action="delete" data-id="${file.id}">🗑 Hủy bỏ</button>
                            </div>
                        </div>
                    </div>
                    <div class="grid-icon-preview ${iconInfo.class}">${iconInfo.icon}</div>
                    <div class="grid-card-body">
                        <div class="file-name" title="${escapeHtml(file.name || "")}">${escapeHtml(file.name || "-")}</div>
                        <div class="file-meta">${formatSize(file.size || 0)} • ${formatDate(file.created_at).split(" ")[0]}</div>
                    </div>
                `;
                gridView.appendChild(card);
            });
        }
    }

    // Checkbox change handler
    const allCheckboxes = document.querySelectorAll(".row-check");
    allCheckboxes.forEach(cb => cb.addEventListener("change", updateSelectCount));

    updateSelectCount();
}

function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// =========================================================
// SỰ KIỆN ĐIỀU HƯỚNG KEBAB MENU TRÊN TOÀN KHÔNG GIAN CÂY
// =========================================================
document.addEventListener("click", e => {
    const dots = e.target.closest(".action-dots");
    document.querySelectorAll(".action-menu.open").forEach(m => {
        if (!dots || m.dataset.menuFor !== dots.dataset.id) m.classList.remove("open");
    });

    if (dots) {
        const menu = document.querySelector(`.action-menu[data-menu-for="${dots.dataset.id}"]`);
        if (menu) menu.classList.toggle("open");
        return;
    }

    const actionBtn = e.target.closest(".action-menu button");
    if (actionBtn) {
        const id = actionBtn.dataset.id;
        const action = actionBtn.dataset.action;
        actionBtn.closest(".action-menu").classList.remove("open");

        if (action === "preview") previewFile(id);
        if (action === "details") showDetails(id);
        if (action === "download") downloadFile(id);
        if (action === "delete") deleteFile(id);
    }
});

// =========================================================
// QUẢN LÝ KHỐI CHỌN & XÓA BÓC TÁCH (BULK ACTIONS)
// =========================================================
function updateSelectCount() {
    const checked = document.querySelectorAll(".row-check:checked");
    const count = checked.length;
    if (selectCountSpan) selectCountSpan.textContent = `Đã chọn ${count} mục`;
    const bulkGroup = document.getElementById("bulk-actions-group");
    if (bulkGroup) bulkGroup.style.display = count > 0 ? "flex" : "none";
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = count > 0 ? "inline-flex" : "none";
}

if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
        const checked = Array.from(document.querySelectorAll(".row-check:checked"));
        if (checked.length === 0) return;
        if (!confirm(`Xác nhận xóa đồng loạt nhóm gồm ${checked.length} tệp tin?`)) return;

        showToast(`Đang thực hiện xóa chuỗi tệp tin...`, "warning");
        for (const cb of checked) {
            await deleteFileSilently(cb.dataset.id);
        }
        showToast("Đã hoàn tất tiến trình xóa chuỗi tệp tin!", "success");
        loadFiles();
    });
}

if (clearAllBtn) {
    clearAllBtn.addEventListener("click", async () => {
        if (allFiles.length === 0) {
            showToast("Hệ thống lưu trữ trống!", "info"); return;
        }
        if (!confirm(`CẢNH BÁO: XÓA HOÀN TOÀN toàn bộ tệp tin (${allFiles.length})? Thao tác này không khôi phục.`)) return;

        showToast("Đang dọn dẹp sạch toàn bộ máy chủ...", "danger");
        for (const file of allFiles.slice()) {
            await deleteFileSilently(file.id);
        }
        showToast("Hệ kho dữ liệu đã được giải phóng hoàn toàn.", "success");
        loadFiles();
    });
}

// =========================================================
// HIỂN THỊ CHI TIẾT CẤU TRÚC PHÂN MẢNH
// =========================================================
async function showDetails(id) {
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const file = await response.json();

        const panel = document.getElementById("file-details-section");
        if (panel) panel.style.display = "block";

        const titleEl = document.getElementById("detail-title-text");
        if (titleEl) titleEl.textContent = file.name || "-";

        if (detailId) detailId.textContent = file.id || "-";
        if (detailName) detailName.textContent = file.name || "-";
        if (detailSize) detailSize.textContent = formatSize(file.size || 0);
        if (detailParts) detailParts.textContent = file.part_count || 1;
        if (detailStatus) detailStatus.textContent = file.status || "-";

        if (partTableBody) {
            partTableBody.innerHTML = "";
            if (Array.isArray(file.parts)) {
                file.parts.forEach(part => {
                    const row = document.createElement("tr");
                    row.innerHTML = `<td>${part.index}</td><td>${formatSize(part.size || 0)}</td><td style="word-break:break-all;font-size:11px;">${part.file_id || "-"}</td>`;
                    partTableBody.appendChild(row);
                });
            }
        }
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        console.error(error);
        showToast("Lỗi nạp thông tin phần mảnh!", "danger");
    }
}

// =========================================================
// PIPELINE XÓA TỪNG PHẦN KHÔNG ĐỂ LẠI RÁC TRÊN TELEGRAM
// =========================================================
async function deleteFileSilently(id) {
    addLog(`[Xóa] Bắt đầu giải mã cấu trúc tệp tin ID: ${id}`);
    try {
        const responseDetails = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const fileMeta = await responseDetails.json();
        const totalParts = fileMeta.part_count || (fileMeta.parts ? fileMeta.parts.length : 1);

        addLog(`[Xóa] Cấu trúc tệp chứa ${totalParts} mảnh Telegram.`);
        for (let partIndex = 1; partIndex <= totalParts; partIndex++) {
            addLog(`[Xóa] Đang thu hồi khối Part ${partIndex}/${totalParts}...`);
            await fetch(`${API}/file/${id}?part=${partIndex}&part_index=${partIndex}`, {
                method: "DELETE",
                headers: { "Authorization": AUTH_HEADER }
            });
        }
        const finalDeleteRes = await fetch(API + "/file/" + id, { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
        if (finalDeleteRes.ok) {
            addLog(`[Thành công] Đã xóa vĩnh viễn tệp: ${fileMeta.name || id}`);
        }
    } catch (error) {
        console.error(error);
        addLog(`[Cảnh báo] Lỗi bóc tách xóa phân mảnh. Chuyển hướng xóa trực tiếp metadata...`);
        try {
            await fetch(API + "/file/" + id, { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
        } catch (f) {}
    }
}

async function deleteFile(id) {
    if (!confirm("Hủy bỏ tệp tin này đồng nghĩa hủy toàn bộ chuỗi mảnh lưu trữ trên luồng Telegram worker?")) return;
    const dots = document.querySelector(`.action-dots[data-id="${id}"]`);
    if (dots) dots.classList.add("btn-pulse-active");

    await deleteFileSilently(id);
    showToast("Xóa tệp tin thành công!", "success");
    loadFiles();
}

// =========================================================
// PREVIEW MODAL SCREEN PIPELINE
// =========================================================
function canPreviewFile(file) {
    const ext = getExt(file.name);
    const isMedia = PREVIEW_IMAGE_EXT.includes(ext) || PREVIEW_VIDEO_EXT.includes(ext) || PREVIEW_AUDIO_EXT.includes(ext) || PREVIEW_PDF_EXT.includes(ext);
    return isMedia && (file.part_count || 1) <= 1;
}

async function previewFile(id) {
    if (!previewModal) return;
    previewTitle.textContent = "Đang nạp dữ liệu truyền dẫn...";
    previewBody.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:20px;">Đang thiết lập luồng hiển thị...</p>`;
    previewModal.style.display = "flex";

    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const file = await response.json();

        if (!file || !Array.isArray(file.parts) || file.parts.length !== 1) {
            previewBody.innerHTML = `<p style="color:var(--text-muted);">Tệp tin kích thước lớn gồm nhiều mảnh không được hỗ trợ xem trước trực tiếp.</p>`;
            previewTitle.textContent = file.name || "Xem trực quan";
            return;
        }

        const part = file.parts[0];
        const ext = getExt(file.name);
        previewTitle.textContent = file.name || "Xem dữ liệu";

        const mediaResponse = await fetch(API + "/download/" + part.file_id, { headers: { "Authorization": AUTH_HEADER } });
        if (!mediaResponse.ok || !mediaResponse.body) {
            previewBody.innerHTML = `<p style="color:var(--text-muted);">Lỗi khởi tạo luồng dữ liệu xem trước.</p>`; return;
        }

        const blob = await mediaResponse.blob();
        const objectUrl = URL.createObjectURL(blob);

        if (PREVIEW_IMAGE_EXT.includes(ext)) {
            previewBody.innerHTML = `<img src="${objectUrl}" alt="${escapeHtml(file.name)}">`;
        } else if (PREVIEW_VIDEO_EXT.includes(ext)) {
            previewBody.innerHTML = `<video src="${objectUrl}" controls autoplay style="width:100%; max-height:65vh;"></video>`;
        } else if (PREVIEW_AUDIO_EXT.includes(ext)) {
            previewBody.innerHTML = `<audio src="${objectUrl}" controls autoplay></audio>`;
        } else if (PREVIEW_PDF_EXT.includes(ext)) {
            const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
            const pdfUrl = URL.createObjectURL(pdfBlob);
            previewBody.innerHTML = `<iframe src="${pdfUrl}" style="width:100%; height:70vh;"></iframe>`;
        } else {
            previewBody.innerHTML = `<p style="color:var(--text-muted);">Định dạng tệp tin nằm ngoài vùng hiển thị trực tiếp.</p>`;
        }
    } catch (error) {
        console.error(error);
        previewBody.innerHTML = `<p style="color:var(--text-muted);">Xử lý luồng xem trước thất bại.</p>`;
    }
}

window.closePreview = function() {
    if (!previewModal) return;
    previewModal.style.display = "none";
    const media = previewBody.querySelector("img, video, audio, iframe");
    if (media) {
        const src = media.src;
        if (src && src.startsWith("blob:")) URL.revokeObjectURL(src);
    }
    previewBody.innerHTML = "";
};

if (previewModal) {
    previewModal.addEventListener("click", e => {
        if (e.target === previewModal) closePreview();
    });
}

// =========================================================
// DOWNLOAD PIPELINE (STREAMSAVER KHÔNG TỐN RAM)
// =========================================================
async function downloadFile(id) {
    addLog("Khởi động: Download dữ liệu tệp " + id);
    let fileMeta;
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        fileMeta = await response.json();
    } catch (error) {
        console.error(error);
        showToast("Thất bại khi lấy phân đoạn cấu trúc!", "danger"); return;
    }

    if (!fileMeta || !Array.isArray(fileMeta.parts) || fileMeta.parts.length === 0) {
        addLog("Hệ thống: Tệp tin rỗng, không có địa chỉ khối tải xuống."); return;
    }

    const parts = fileMeta.parts.slice().sort((a, b) => a.index - b.index);
    const totalParts = parts.length;
    const fileStream = streamSaver.createWriteStream(fileMeta.name || "download.bin", { size: fileMeta.size || undefined });
    const writer = fileStream.getWriter();

    if (downloadManagerPanel) downloadManagerPanel.style.display = "block";
    if (downloadingFileName) downloadingFileName.textContent = fileMeta.name || id;
    if (downloadProgressBar) downloadProgressBar.style.width = "0%";
    if (downloadStatus) downloadStatus.textContent = `0%`;

    let totalDownloaded = 0;
    const totalSizeBytes = Number(fileMeta.size || 0);
    showToast("Đang bắt đầu tải xuống luồng tuần tự...", "info");

    try {
        for (let i = 0; i < totalParts; i++) {
            const part = parts[i];
            const response = await fetch(API + "/download/" + part.file_id, { headers: { "Authorization": AUTH_HEADER } });
            if (!response.ok || !response.body) throw new Error(`Mất luồng kết nối part thứ ${i + 1}`);
            
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
                totalDownloaded += value.length;
                if (totalSizeBytes > 0) {
                    const percent = Math.min(100, Math.round((totalDownloaded / totalSizeBytes) * 100));
                    if (downloadProgressBar) downloadProgressBar.style.width = percent + "%";
                    if (downloadStatus) downloadStatus.textContent = `${percent}%`;
                }
            }
            addLog(`Hệ thống: Đã ghép luồng phần ${i + 1}/${totalParts}`);
        }
        await writer.close();
        if (downloadProgressBar) downloadProgressBar.style.width = "100%";
        if (downloadStatus) downloadStatus.textContent = "Hoàn thành";
        showToast("Tệp tin đã tải xuống hoàn tất!", "success");
        addLog("Tải xuống hoàn tất: " + (fileMeta.name || id));

        setTimeout(() => {
            if (downloadManagerPanel) downloadManagerPanel.style.display = "none";
        }, 1500);
    } catch (error) {
        console.error(error);
        if (downloadStatus) downloadStatus.textContent = "Lỗi luồng";
        showToast("Tiến trình tải xuống gián đoạn!", "danger");
        try { await writer.abort(); } catch (e) {}
    }
}

// =========================================================
// BỘ TIỆN ÍCH ĐỊNH DẠNG DỮ LIỆU LOGS & SIZE
// =========================================================
function addLog(text) {
    if (!logList) return;
    const li = document.createElement("li");
    li.style.listStyle = "none";
    li.textContent = `[${new Date().toLocaleTimeString()}] > ${text}`;
    logList.prepend(li);
}

function formatSize(bytes) {
    bytes = Number(bytes || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function formatDate(timestamp) {
    if (!timestamp) return "-";
    return new Date(timestamp).toLocaleString();
}

/**
 * Event delegation chính - Sidebar nav + context menu
 * Upload trigger được xử lý qua uploadBtn listener phía trên
 */
document.addEventListener("click", e => {
    // Sidebar Navigation
    const navItem = e.target.closest(".nav-item");
    if (navItem) {
        document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
        navItem.classList.add("active");
        const tab = navItem.dataset.tab;
        const logSection = document.getElementById("internal-logs-section");
        const mainView = document.querySelector(".data-view-scroller");
        const statsBar = document.querySelector(".stats-banner");

        if (tab === "logs") {
            if (logSection) logSection.style.display = "block";
            if (mainView) mainView.style.display = "none";
            if (statsBar) statsBar.style.display = "none";
        } else {
            if (logSection) logSection.style.display = "none";
            if (mainView) mainView.style.display = "";
            if (statsBar) statsBar.style.display = "";
            if (tab === "my-drive") loadFiles();
        }
        return;
    }

    // Đóng context menu khi click ra ngoài
    const ctxMenu = document.getElementById("custom-context-menu");
    if (ctxMenu && !e.target.closest("#custom-context-menu") && !e.target.closest(".kebab-btn")) {
        ctxMenu.style.display = "none";
    }
});

// Close details drawer
const closeDetailsBtn = document.getElementById("close-details-btn");
if (closeDetailsBtn) {
    closeDetailsBtn.addEventListener("click", () => {
        if (detailsPanel) detailsPanel.style.display = "none";
    });
}

// Sort select
const sortSelect = document.getElementById("sort-select");
if (sortSelect) {
    sortSelect.addEventListener("change", () => {
        const val = sortSelect.value;
        const [k, d] = val.split("-");
        sortKey = k === "date" ? "created_at" : k === "name" ? "name" : "size";
        sortDir = d === "desc" ? -1 : 1;
        renderFiles();
    });
}

// Empty trash button
const emptyTrashBtn = document.getElementById("btn-empty-trash");
if (emptyTrashBtn) {
    emptyTrashBtn.addEventListener("click", async () => {
        if (!confirm("Dọn sạch thùng rác?")) return;
        try {
            await fetch(API + "/trash", { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
            showToast("Đã dọn sạch thùng rác!", "success");
            loadFiles();
        } catch (e) {
            showToast("Lỗi khi dọn thùng rác", "danger");
        }
    });
}

// Cancel process button
const btnProcessCancel = document.getElementById("btn-process-cancel");
if (btnProcessCancel) {
    btnProcessCancel.addEventListener("click", () => {
        uploadState.cancelled = true;
        uploadState.paused = false;
        if (uploadManagerPanel) uploadManagerPanel.style.display = "none";
        showToast("Đã hủy tiến trình!", "warning");
    });
}

/* ====================================================================
   ★ RESPONSIVE ADDITIONS — Appended to original app.js (nothing deleted)
   Handles:
   1. Hamburger / Off-canvas sidebar drawer
   2. Sidebar overlay click-to-close
   3. Drag-and-drop on stats-dropzone-wrapper → triggers file upload
   4. Updates querySelectorAll usage to also catch new wrapper elements
   ==================================================================== */

(function initResponsiveFeatures() {
    "use strict";

    // ── 1. DOM references (new elements added in HTML) ──────────────
    const hamburgerBtn   = document.getElementById("hamburger-btn");
    const sidebarEl      = document.querySelector(".sidebar");
    const sidebarOverlay = document.getElementById("sidebar-overlay");
    const dropzoneWrap   = document.getElementById("stats-dropzone-wrapper");
    const dropzoneHint   = document.getElementById("dropzone-hint");

    // The existing file input reference (from original app.js)
    const fileInputEl = document.getElementById("file-input");

    // ── 2. Hamburger — open/close drawer ──────────────────────────
    function openDrawer() {
        if (!sidebarEl) return;
        sidebarEl.classList.add("drawer-open");
        if (sidebarOverlay) sidebarOverlay.classList.add("active");
        document.body.style.overflow = "hidden"; // prevent background scroll
    }
    function closeDrawer() {
        if (!sidebarEl) return;
        sidebarEl.classList.remove("drawer-open");
        if (sidebarOverlay) sidebarOverlay.classList.remove("active");
        document.body.style.overflow = "";
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (sidebarEl && sidebarEl.classList.contains("drawer-open")) {
                closeDrawer();
            } else {
                openDrawer();
            }
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", closeDrawer);
    }

    // Close drawer when a nav-item is clicked (on mobile, user chose a tab)
    document.addEventListener("click", (e) => {
        const navItem = e.target.closest(".nav-item");
        if (navItem && window.innerWidth <= 900) {
            closeDrawer();
        }
    });

    // Close drawer on Escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeDrawer();
    });

    // ── 3. Hamburger icon visibility: show on mobile, hide on desktop ──
    function updateHamburgerVisibility() {
        if (!hamburgerBtn) return;
        hamburgerBtn.style.display = (window.innerWidth <= 900) ? "flex" : "none";
        // On resize to desktop, also close any open drawer
        if (window.innerWidth > 900) closeDrawer();
    }
    updateHamburgerVisibility();
    window.addEventListener("resize", updateHamburgerVisibility);

    // ── 4. Drag-and-drop onto the stats-banner / drop-zone wrapper ──
    if (!dropzoneWrap || !fileInputEl) return;

    let dragCounter = 0; // track nested dragenter/dragleave events

    dropzoneWrap.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter++;
        dropzoneWrap.classList.add("drag-over");
        if (dropzoneHint) dropzoneHint.style.display = "flex";
    });

    dropzoneWrap.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
    });

    dropzoneWrap.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropzoneWrap.classList.remove("drag-over");
            if (dropzoneHint) dropzoneHint.style.display = "none";
        }
    });

    dropzoneWrap.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter = 0;
        dropzoneWrap.classList.remove("drag-over");
        if (dropzoneHint) dropzoneHint.style.display = "none";

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        // Transfer DataTransfer files to the hidden file input
        // (DataTransfer is read-only for .files, so we use a workaround:
        //  dispatch a synthetic input via a new DataTransfer object)
        try {
            const dt = new DataTransfer();
            for (const file of files) dt.items.add(file);
            fileInputEl.files = dt.files;
            // Trigger the existing "change" event listener on fileInputEl
            fileInputEl.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (err) {
            // Fallback: show toast if DataTransfer assignment fails (Safari)
            if (typeof showToast === "function") {
                showToast("Trình duyệt của bạn không hỗ trợ kéo-thả trực tiếp. Vui lòng dùng nút Tải lên.", "warning");
            }
        }
    });

    // ── 5. Also allow dragging over the whole main-workspace when mobile ──
    //       (users might drop on the file list area too)
    const mainWorkspace = document.querySelector(".main-workspace");
    if (mainWorkspace) {
        mainWorkspace.addEventListener("dragover", (e) => e.preventDefault());
        mainWorkspace.addEventListener("drop", (e) => {
            // Only handle if NOT handled by dropzoneWrap
            if (e.target.closest("#stats-dropzone-wrapper")) return;
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (!files || files.length === 0) return;
            try {
                const dt = new DataTransfer();
                for (const file of files) dt.items.add(file);
                fileInputEl.files = dt.files;
                fileInputEl.dispatchEvent(new Event("change", { bubbles: true }));
            } catch (_) { /* silent fail */ }
        });
    }

})(); // end initResponsiveFeatures IIFE
/* ====================================================================
   ★ PHASE 3 — MOBILE DRAWER + FAB (Append, không xóa code cũ) ★
   - Tạo FAB động (#mobile-fab-menu)
   - Toggle .sidebar.drawer-open + .drawer-overlay.active
   - Tự ẩn/hiện theo breakpoint 768px
   ==================================================================== */
(function initMobileDrawerFAB() {
    "use strict";

    const sidebarEl = document.querySelector(".sidebar");
    let   overlayEl = document.getElementById("sidebar-overlay");

    // Nếu overlay chưa có trong HTML, tạo động (an toàn 2 chiều)
    if (!overlayEl) {
        overlayEl = document.createElement("div");
        overlayEl.id = "sidebar-overlay";
        overlayEl.className = "drawer-overlay";
        document.body.appendChild(overlayEl);
    }

    // ── Tạo FAB động ──
    let fab = document.getElementById("mobile-fab-menu");
    if (!fab) {
        fab = document.createElement("button");
        fab.id = "mobile-fab-menu";
        fab.setAttribute("aria-label", "Mở menu điều hướng");
        fab.innerHTML = '<i class="fa-solid fa-bars"></i>';
        document.body.appendChild(fab);
    }

    const MOBILE_BP = 768;

    function isMobile() { return window.innerWidth <= MOBILE_BP; }

    function openDrawer() {
        if (!sidebarEl) return;
        sidebarEl.classList.add("drawer-open");
        overlayEl.classList.add("active");
        fab.classList.add("fab-rotate");
        fab.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        document.body.style.overflow = "hidden";
    }
    function closeDrawer() {
        if (!sidebarEl) return;
        sidebarEl.classList.remove("drawer-open");
        overlayEl.classList.remove("active");
        fab.classList.remove("fab-rotate");
        fab.innerHTML = '<i class="fa-solid fa-bars"></i>';
        document.body.style.overflow = "";
    }
    function toggleDrawer() {
        if (sidebarEl && sidebarEl.classList.contains("drawer-open")) closeDrawer();
        else openDrawer();
    }

    fab.addEventListener("click", (e) => { e.stopPropagation(); toggleDrawer(); });
    overlayEl.addEventListener("click", closeDrawer);

    // Đóng drawer khi chọn nav-item (mobile)
    document.addEventListener("click", (e) => {
        if (e.target.closest(".nav-item") && isMobile()) closeDrawer();
    });

    // Đóng khi bấm nút Upload (mở hộp thoại chọn file)
    const upBtn = document.getElementById("btn-upload-trigger");
    if (upBtn) upBtn.addEventListener("click", () => { if (isMobile()) closeDrawer(); });

    // Đóng bằng Escape
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

    // Hiện/ẩn FAB + reset drawer theo kích thước
    function syncBreakpoint() {
        fab.style.display = isMobile() ? "flex" : "none";
        if (!isMobile()) closeDrawer();
    }

    // Debounce resize
    let rt;
    window.addEventListener("resize", () => {
        clearTimeout(rt);
        rt = setTimeout(syncBreakpoint, 120);
    });

    syncBreakpoint();
})();

/* ====================================================================
   ★ PHASE 4 — PROGRESSIVE RANGE STREAMING ENGINE
   Appended below original app.js. ZERO deletions.

   Luồng hoạt động:
   1. previewFile(id) được override:
      - Fetch metadata từ Worker API
      - Lưu { id, parts, totalSize, mimeType, apiBase } vào IDB store "stream_meta"
      - Đợi SW ready, rồi gán src = "/api/stream?id=<id>&auth=<token>"
      - <video>/<audio> tự gửi Range request → SW phục vụ
   2. Hàm cũ previewFile bị giữ nguyên nhưng bị override ở scope global
   ====================================================================*/

// ─── IDB helpers riêng cho stream_meta (tránh dùng db có thể chưa ready) ─────
const STREAM_META_STORE = "stream_meta";
const STREAM_DB_VERSION = 2; // khớp sw.js

function openStreamMetaDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("tgdrive_db", STREAM_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("upload_progress")) {
                db.createObjectStore("upload_progress", { keyPath: "sessionKey" });
            }
            if (!db.objectStoreNames.contains(STREAM_META_STORE)) {
                db.createObjectStore(STREAM_META_STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
        setTimeout(() => reject(new Error("IDB stream open timeout")), 5000);
    });
}

function streamMetaPut(db, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STREAM_META_STORE, "readwrite");
        tx.objectStore(STREAM_META_STORE).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
    });
}

// ─── SW ready check ────────────────────────────────────────────────────────────
async function waitForSW() {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    return !!reg;
}

// ─── File-type helpers for Phase-4 ────────────────────────────────────────────
const P4_STREAMABLE_VIDEO = ["mp4", "webm", "ogg", "mov", "mkv", "avi", "m4v"];
const P4_STREAMABLE_AUDIO = ["mp3", "wav", "m4a", "aac", "flac", "ogg"];
const P4_TEXT_EXT = [
    "txt", "md", "json", "js", "ts", "jsx", "tsx", "html", "htm",
    "css", "py", "sh", "bash", "yml", "yaml", "xml", "csv", "log",
    "ini", "conf", "env", "sql", "toml"
];

function p4GetExt(name) {
    const dot = (name || "").lastIndexOf(".");
    if (dot === -1) return "";
    return name.slice(dot + 1).toLowerCase().split(".part")[0];
}

function p4GetMimeForStream(ext) {
    const map = {
        mp4:"video/mp4", webm:"video/webm", ogg:"video/ogg", mov:"video/mp4",
        mkv:"video/mp4", avi:"video/mp4", m4v:"video/mp4",
        mp3:"audio/mpeg", wav:"audio/wav", m4a:"audio/mp4", aac:"audio/aac",
        flac:"audio/flac"
    };
    return map[ext] || "video/mp4";
}

// ─── TEXT PREVIEW helper ──────────────────────────────────────────────────────
async function previewTextFile(url, fetchHeaders, fileNameForLang) {
    const res  = await fetch(url, { headers: fetchHeaders });
    if (!res.ok) throw new Error("Fetch text failed: " + res.status);
    const text = await res.text();

    const ext  = p4GetExt(fileNameForLang);
    const langMap = {
        js:"javascript", ts:"javascript", jsx:"javascript", tsx:"javascript",
        json:"json", html:"html", htm:"html", css:"css", py:"python",
        sh:"bash", bash:"bash", yml:"yaml", yaml:"yaml", xml:"xml",
        sql:"sql", md:"markdown"
    };
    const lang = langMap[ext] || "";

    // Escape HTML
    const escaped = text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    return `<pre style="
        width:100%; max-height:70vh; overflow:auto;
        background:#0a0f1e; color:#a5f3fc;
        padding:16px; border-radius:10px;
        font-family:'JetBrains Mono','Fira Code',monospace; font-size:13px;
        line-height:1.6; text-align:left; white-space:pre-wrap; word-break:break-word;
        border:1px solid rgba(139,92,246,0.2);"
    ><code class="language-${lang}">${escaped}</code></pre>`;
}

// ─── OVERRIDE previewFile ─────────────────────────────────────────────────────
// Ghi đè hàm previewFile cũ trong scope window — hàm cũ vẫn tồn tại nhưng
// không được gọi nữa; logic cũ (single-part image/video/audio/pdf) được
// tích hợp lại ở đây với fallback đầy đủ.
//
window._p4OrigPreviewFile = typeof previewFile !== "undefined" ? previewFile : null;

async function previewFile(id) {
    const modal = document.getElementById("preview-modal");
    const title = document.getElementById("preview-title");
    const body  = document.getElementById("preview-body");

    if (!modal || !body || !title) return;

    // Reset & show modal
    title.textContent = "Đang nạp siêu dữ liệu...";
    body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px;color:var(--text-muted);">
        <div style="width:40px;height:40px;border:3px solid rgba(139,92,246,0.4);border-top-color:#8b5cf6;
             border-radius:50%;animation:spinLoad 0.9s linear infinite;"></div>
        <span>Đang khởi tạo luồng phương tiện...</span>
    </div>
    <style>@keyframes spinLoad{to{transform:rotate(360deg)}}</style>`;
    modal.style.display = "flex";

    let file;
    try {
        const res = await fetch(API + "/file/" + id, {
            headers: { Authorization: AUTH_HEADER }
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        file = await res.json();
    } catch (err) {
        body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">Lỗi lấy metadata: ${err.message}</p>`;
        return;
    }

    title.textContent = file.name || "Xem trước";

    const ext  = p4GetExt(file.name);
    const parts = Array.isArray(file.parts) ? [...file.parts].sort((a,b) => a.index - b.index) : [];

    if (parts.length === 0) {
        body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">Tệp không có dữ liệu part.</p>`;
        return;
    }

    // ── TEXT/CODE files (chỉ single-part để tránh OOM) ──────────────
    if (P4_TEXT_EXT.includes(ext) && parts.length === 1) {
        try {
            const dlUrl    = API + "/download/" + parts[0].file_id;
            body.innerHTML = await previewTextFile(dlUrl, { Authorization: AUTH_HEADER }, file.name);
        } catch (err) {
            body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">Lỗi đọc text: ${err.message}</p>`;
        }
        return;
    }

    // ── IMAGE (single-part, tải trực tiếp) ───────────────────────────
    const isImage = ["jpg","jpeg","png","gif","webp","bmp","svg"].includes(ext);
    if (isImage && parts.length === 1) {
        try {
            const blobRes = await fetch(API + "/download/" + parts[0].file_id,
                { headers: { Authorization: AUTH_HEADER } });
            const blob   = await blobRes.blob();
            const objUrl = URL.createObjectURL(blob);
            body.innerHTML = "";
            const img = document.createElement("img");
            img.src   = objUrl;
            img.style.cssText = "max-width:100%;max-height:78vh;border-radius:8px;object-fit:contain;";
            body.appendChild(img);
        } catch (err) {
            body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">Lỗi tải ảnh: ${err.message}</p>`;
        }
        return;
    }

    // ── PDF (single-part, tải trực tiếp) ─────────────────────────────
    if (ext === "pdf" && parts.length === 1) {
        try {
            const blobRes = await fetch(API + "/download/" + parts[0].file_id,
                { headers: { Authorization: AUTH_HEADER } });
            const blob   = await blobRes.blob();
            const pdfUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
            body.innerHTML = `<iframe src="${pdfUrl}" style="width:100%;height:72vh;border:none;border-radius:8px;"></iframe>`;
        } catch (err) {
            body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">Lỗi tải PDF: ${err.message}</p>`;
        }
        return;
    }

    // ── VIDEO / AUDIO — kích hoạt Service Worker Range Streaming ─────
    const isVideo = P4_STREAMABLE_VIDEO.includes(ext);
    const isAudio = P4_STREAMABLE_AUDIO.includes(ext);

    if (!isVideo && !isAudio) {
        body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">
            Định dạng <strong>.${ext}</strong> không hỗ trợ xem trước trực tiếp.<br>
            Vui lòng tải xuống để mở bằng ứng dụng ngoài.</p>`;
        return;
    }

    // Tính totalSize từ metadata hoặc cộng dồn từ parts
    const totalSize = Number(file.size || 0) ||
        parts.reduce((s, p) => s + Number(p.size || 0), 0);

    const mimeType = p4GetMimeForStream(ext);

    // Kiểm tra SW khả dụng
    const swReady = await waitForSW();

    if (swReady && parts.length > 1) {
        // Multi-part → dùng SW Range Streaming
        await p4StreamViaServiceWorker({
            id, file, parts, totalSize, mimeType, isVideo, body, title
        });
    } else if (parts.length === 1) {
        // Single-part → tải blob trực tiếp (nhanh hơn)
        await p4StreamSinglePartBlob({ part: parts[0], mimeType, isVideo, body, file });
    } else {
        // SW không có + multi-part → blob concatenation (bộ nhớ nhiều)
        await p4StreamConcatBlob({ parts, mimeType, isVideo, body, file, totalSize });
    }
}

// ─── SW streaming path ────────────────────────────────────────────────────────
async function p4StreamViaServiceWorker({ id, file, parts, totalSize, mimeType, isVideo, body }) {
    // Lưu metadata vào IDB để SW đọc
    try {
        const idb = await openStreamMetaDB();
        await streamMetaPut(idb, {
            id,
            parts: parts.map(p => ({
                index  : p.index,
                file_id: p.file_id,
                size   : Number(p.size || 0)
            })),
            totalSize,
            mimeType,
            apiBase: API   // Worker URL
        });
    } catch (err) {
        // IDB write failed → fallback
        console.warn("[P4] IDB write failed, fallback to concat:", err);
        await p4StreamConcatBlob({ parts, mimeType, isVideo, body, file, totalSize });
        return;
    }

    const streamUrl = `/api/stream?id=${encodeURIComponent(id)}&auth=${encodeURIComponent(AUTH_HEADER)}&t=${Date.now()}`;

    body.innerHTML = "";

    const statusEl = document.createElement("div");
    statusEl.style.cssText = "font-size:12px;color:var(--text-muted);text-align:center;padding:4px 0 10px;";
    statusEl.textContent = `⚡ SW Range Streaming • ${parts.length} parts • ${_p4FmtSize(totalSize)}`;
    body.appendChild(statusEl);

    const tag  = isVideo ? "video" : "audio";
    const el   = document.createElement(tag);
    el.controls    = true;
    el.autoplay    = true;
    el.playsInline = true;
    el.style.cssText = "width:100%;max-height:72vh;border-radius:10px;display:block;";

    body.appendChild(el);

    // Gán src SAU khi element nằm trong DOM
    el.src = streamUrl;

    el.addEventListener("error", async (ev) => {
        console.warn("[P4] SW stream error, fallback:", ev);
        statusEl.textContent = "⚠ SW lỗi, chuyển sang tải trực tiếp...";
        await p4StreamConcatBlob({ parts, mimeType, isVideo, body, file, totalSize });
    }, { once: true });
}

// ─── Single-part blob path ────────────────────────────────────────────────────
async function p4StreamSinglePartBlob({ part, mimeType, isVideo, body, file }) {
    try {
        const res  = await fetch(API + "/download/" + part.file_id,
            { headers: { Authorization: AUTH_HEADER } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob   = await res.blob();
        const objUrl = URL.createObjectURL(new Blob([blob], { type: mimeType }));

        body.innerHTML = "";
        const tag  = isVideo ? "video" : "audio";
        const el   = document.createElement(tag);
        el.controls    = true;
        el.autoplay    = true;
        el.playsInline = true;
        el.src         = objUrl;
        el.style.cssText = "width:100%;max-height:72vh;border-radius:10px;display:block;";
        body.appendChild(el);
    } catch (err) {
        body.innerHTML = `<p style="color:var(--text-muted);padding:24px;">Lỗi tải media: ${err.message}</p>`;
    }
}

// ─── Multi-part concat blob (fallback, memory-intensive) ─────────────────────
async function p4StreamConcatBlob({ parts, mimeType, isVideo, body, file, totalSize }) {
    body.innerHTML = "";

    const tag   = isVideo ? "video" : "audio";
    const el    = document.createElement(tag);
    el.controls    = true;
    el.playsInline = true;
    el.style.cssText = "width:100%;max-height:72vh;border-radius:10px;display:block;";

    const progWrap = document.createElement("div");
    progWrap.style.cssText = "margin-bottom:10px;";
    progWrap.innerHTML = `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;" id="p4-dl-status">
            Đang tải part 1/${parts.length}...
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden;">
            <div id="p4-dl-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#8b5cf6,#6366f1);
                 border-radius:99px;transition:width 0.3s ease;"></div>
        </div>`;
    body.appendChild(progWrap);
    body.appendChild(el);

    const statusEl = document.getElementById("p4-dl-status");
    const barEl    = document.getElementById("p4-dl-bar");

    const blobs = [];
    try {
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (statusEl) statusEl.textContent = `Đang tải part ${i+1}/${parts.length}...`;

            const res = await fetch(API + "/download/" + p.file_id,
                { headers: { Authorization: AUTH_HEADER } });
            if (!res.ok) throw new Error(`Part ${i+1} HTTP ${res.status}`);
            blobs.push(await res.blob());

            const pct = Math.round(((i + 1) / parts.length) * 100);
            if (barEl) barEl.style.width = pct + "%";
        }

        const final  = new Blob(blobs, { type: mimeType });
        const objUrl = URL.createObjectURL(final);
        el.src       = objUrl;
        el.autoplay  = true;
        if (progWrap) progWrap.remove();
    } catch (err) {
        if (statusEl) statusEl.textContent = "Lỗi: " + err.message;
        console.error("[P4] concat blob error:", err);
    }
}

// ─── Size formatter (local, không dùng formatSize vì scope) ──────────────────
function _p4FmtSize(bytes) {
    bytes = Number(bytes || 0);
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(2) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
}

// ─── Override canPreviewFile — mở rộng hỗ trợ multi-part video/audio ─────────
// Hàm cũ chỉ cho phép part_count <= 1. Bây giờ video/audio nhiều part cũng OK.
window._p4OrigCanPreview = typeof canPreviewFile !== "undefined" ? canPreviewFile : null;

function canPreviewFile(file) {
    const ext = p4GetExt(file.name);

    // Text & image & pdf: vẫn chỉ single-part
    const singleOnly = [
        "jpg","jpeg","png","gif","webp","bmp","svg",
        "pdf",
        ...P4_TEXT_EXT
    ];
    if (singleOnly.includes(ext)) {
        return (file.part_count || 1) <= 1;
    }

    // Video/audio: hỗ trợ bất kể số part (có SW hoặc concat fallback)
    if (P4_STREAMABLE_VIDEO.includes(ext) || P4_STREAMABLE_AUDIO.includes(ext)) {
        return true;
    }

    return false;
}

console.log("[TG-Drive P4] Streaming engine loaded ✓");
