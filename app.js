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
const loginPage = document.querySelector("#login-page") || document.querySelector(".login-page");
const dashboard = document.querySelector("#dashboard") || document.querySelector(".dashboard-layout");
const loginForm = document.querySelector(".login-form") || document.querySelector(".login-card");
const passwordInput = document.querySelector(".password-input") || document.querySelector(".input[type='password']");
const uploadBtn = document.querySelector(".upload-btn") || document.querySelector(".btn-upload-trigger");
const uploadInput = document.querySelector("#input-file");
const partSizeSelect = document.querySelector("#part-size") || document.querySelector(".select-custom");
const logoutBtn = document.querySelector(".logout-btn") || document.querySelector(".nav-item[data-action='logout']");
const totalFiles = document.querySelector(".total-files") || document.querySelector(".stat-value[data-stat='total']");
const totalSize = document.querySelector(".total-size") || document.querySelector(".stat-value[data-stat='size']");
const usedSize = document.querySelector(".used-size") || document.querySelector(".storage-info-text span");

// Các thành phần góc nhìn & vùng chứa tệp tin nâng cấp
const dataViewScroller = document.querySelector(".data-view-scroller");
const btnToggleList = document.querySelector(".btn-toggle[data-view='list']");
const btnToggleGrid = document.querySelector(".btn-toggle[data-view='grid']");
const storageProgressFill = document.querySelector(".storage-progress-fill");

// Panels Tiến trình
const uploadManagerPanel = document.querySelector("#upload-manager-panel") || document.querySelector(".mini-progress-panel");
const uploadingFileName = document.querySelector(".uploading-file-name") || document.querySelector(".process-filename");
const uploadProgressBar = document.getElementById("download-progress-bar");
const uploadProgressText = document.getElementById("progress-speed");
const managerUploadBar = document.querySelector(".manager-upload-progress-bar") || document.querySelector(".liquid-progress-bar");
const uploadStatus = document.querySelector(".upload-status") || document.querySelector(".process-status-row span:last-child");
const currentPartText = document.getElementById("progress-parts-count");
const uploadControls = document.querySelector("#upload-controls") || document.querySelector(".process-controls-row");
const btnPause = document.querySelector("#btn-pause") || document.querySelector(".btn-ctrl-action:not(.danger)");
const btnResume = document.querySelector("#btn-resume");

const downloadManagerPanel = document.querySelector("#download-manager-panel");
const downloadingFileName = document.querySelector(".downloading-file-name");
const downloadProgressBar = document.querySelector(".download-progress-bar");
const downloadStatus = document.querySelector(".download-status");

const detailsPanel = document.querySelector("#details-panel") || document.querySelector(".file-details-drawer");
const detailId = document.querySelector(".detail-id");
const detailName = document.querySelector(".detail-name");
const detailSize = document.querySelector(".detail-size");
const detailParts = document.querySelector(".detail-parts");
const detailStatus = document.querySelector(".detail-status");
const partTableBody = document.querySelector(".part-table-body");

const logList = document.querySelector(".log-list") || document.querySelector(".log-terminal-box");
const searchInput = document.querySelector("#search-input");
const bulkDeleteBtn = document.querySelector("#bulk-delete-btn");
const selectCountSpan = document.querySelector("#select-count") || document.querySelector(".selected-count");
const clearAllBtn = document.querySelector("#clear-all-storage-btn");

const previewModal = document.querySelector("#preview-modal") || document.querySelector(".modal");
const previewTitle = document.querySelector("#preview-title");
const previewBody = document.querySelector("#preview-body") || document.querySelector(".modal-body-content");

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
            renderFiles();
        });

        btnToggleGrid.addEventListener("click", () => {
            currentView = "grid";
            localStorage.setItem("tgdrive_view_pref", "grid");
            btnToggleGrid.classList.add("active");
            btnToggleList.classList.remove("active");
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
    if (!dataViewScroller) return;

    let totalBytes = 0;
    allFiles.forEach(f => totalBytes += Number(f.size || 0));

    // Cập nhật thông số Banner
    if (totalFiles) totalFiles.textContent = allFiles.length;
    if (totalSize) totalSize.textContent = formatSize(totalBytes);
    if (usedSize) usedSize.textContent = `Đã sử dụng ${formatSize(totalBytes)}`;
    
    // Tạo chuyển động co giãn mượt mà cho thanh lưu trữ (Giới hạn tượng trưng 100GB)
    const storagePercent = Math.min(100, Math.max(2, (totalBytes / (100 * 1024 * 1024 * 1024)) * 100));
    if (storageProgressFill) storageProgressFill.style.width = storagePercent + "%";

    // Xử lý Giao diện Trống (Empty State)
    if (files.length === 0) {
        dataViewScroller.innerHTML = `
            <div class="empty-state-view">
                <div class="empty-icon-box">🛸</div>
                <h3>Không tìm thấy dữ liệu tệp tin</h3>
                <p>Kho lưu trữ trống hoặc từ khóa tìm kiếm không khớp.</p>
            </div>
        `;
        updateSelectCount();
        return;
    }

    // 1. GIAO DIỆN HIỂN THỊ DANH SÁCH (LIST VIEW)
    if (currentView === "list") {
        dataViewScroller.innerHTML = `
            <table class="modern-table">
                <thead>
                    <tr>
                        <th width="40"><input type="checkbox" id="select-all" class="custom-checkbox"></th>
                        <th onclick="sortTable(1)" style="cursor:pointer;">Tên tệp tin <span style="font-size:11px;">↕</span></th>
                        <th onclick="sortTable(2)" style="cursor:pointer;">Dung lượng <span style="font-size:11px;">↕</span></th>
                        <th onclick="sortTable(3)" style="cursor:pointer;">Ngày tạo <span style="font-size:11px;">↕</span></th>
                        <th style="text-align:right;">Hành động</th>
                    </tr>
                </thead>
                <tbody class="file-table-body"></tbody>
            </table>
        `;

        const fileTableBody = dataViewScroller.querySelector(".file-table-body");
        
        files.forEach(file => {
            const tr = document.createElement("tr");
            tr.dataset.id = file.id;
            const iconInfo = getVisualIconInfo(file.name);

            tr.innerHTML = `
            <td><input type="checkbox" class="row-check custom-checkbox" data-id="${file.id}"></td>
            <td>
                <div class="file-name-cell" title="${escapeHtml(file.name || "")}">
                    <div class="file-icon-box ${iconInfo.class}">${iconInfo.icon}</div>
                    <span class="file-name-text">${escapeHtml(file.name || "-")}</span>
                </div>
            </td>
            <td>${formatSize(file.size || 0)}</td>
            <td>${formatDate(file.created_at)}</td>
            <td class="action-cell" style="text-align:right;">
                <button class="kebab-btn action-dots" data-id="${file.id}">&#8942;</button>
                <div class="action-menu" data-menu-for="${file.id}">
                    ${canPreviewFile(file) ? `<button data-action="preview" data-id="${file.id}">👁 Xem trước</button>` : ""}
                    <button data-action="details" data-id="${file.id}">ℹ Chi tiết</button>
                    <button data-action="download" data-id="${file.id}">⬇ Tải tệp</button>
                    <button class="danger" data-action="delete" data-id="${file.id}">🗑 Xóa bỏ</button>
                </div>
            </td>
            `;
            fileTableBody.appendChild(tr);
        });

        // Tái ràng buộc sự kiện Chọn tất cả
        const selectAllCb = dataViewScroller.querySelector("#select-all");
        if (selectAllCb) {
            selectAllCb.addEventListener("change", () => {
                dataViewScroller.querySelectorAll(".row-check").forEach(cb => cb.checked = selectAllCb.checked);
                updateSelectCount();
            });
        }

    // 2. GIAO DIỆN HIỂN THỊ LƯỚI KHỐI CAO CẤP (GRID VIEW LIKE DROPBOX)
    } else {
        dataViewScroller.innerHTML = `<div class="file-grid-view-container"></div>`;
        const gridContainer = dataViewScroller.querySelector(".file-grid-view-container");

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
                <div class="grid-icon-preview ${iconInfo.class}" style="align-self:center; margin: 8px 0;">
                    ${iconInfo.icon}
                </div>
                <div class="grid-card-body">
                    <div class="file-name" title="${escapeHtml(file.name || "")}">${escapeHtml(file.name || "-")}</div>
                    <div class="file-meta">${formatSize(file.size || 0)} • ${formatDate(file.created_at).split(" ")[0]}</div>
                </div>
            `;
            gridContainer.appendChild(card);
        });
    }

    // Gắn trình lắng nghe thay đổi checkbox cho cả 2 chế độ view
    dataViewScroller.querySelectorAll(".row-check").forEach(cb => {
        cb.addEventListener("change", updateSelectCount);
    });

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
    const checked = dataViewScroller ? dataViewScroller.querySelectorAll(".row-check:checked") : [];
    if (selectCountSpan) selectCountSpan.textContent = checked.length;
    if (bulkDeleteBtn) {
        bulkDeleteBtn.style.display = checked.length > 0 ? "inline-flex" : "none";
    }
}

if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
        const checked = Array.from(dataViewScroller.querySelectorAll(".row-check:checked"));
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

        if (detailsPanel) detailsPanel.style.display = "block";
        if (detailId) detailId.textContent = "ID: " + (file.id || "-");
        if (detailName) detailName.textContent = "Tên: " + (file.name || "-");
        if (detailSize) detailSize.textContent = "Dung lượng gốc: " + formatSize(file.size || 0);
        if (detailParts) detailParts.textContent = "Số lượng khối mảnh: " + (file.part_count || 1);
        if (detailStatus) detailStatus.textContent = "Trạng thái: " + (file.status || "-");

        if (partTableBody) {
            partTableBody.innerHTML = "";
            if (Array.isArray(file.parts)) {
                file.parts.forEach(part => {
                    const row = document.createElement("tr");
                    row.innerHTML = `<td>${part.index}</td><td>${part.name || "-"}</td><td>${part.file_id || "-"}</td><td>${part.message_id || "-"}</td>`;
                    partTableBody.appendChild(row);
                });
            }
        }
        if (detailsPanel) detailsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
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
    const writer = fileStream.WriteStream ? fileStream.WriteStream.getWriter() : fileStream.getWriter();

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
