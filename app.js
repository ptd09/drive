/**
 * TG-Drive Frontend Logic - PRO V4 (khớp với index.html "TG-Drive Pro")
 * -----------------------------------------------------------------
 * - Đăng nhập bằng mật khẩu tĩnh (lưu LocalStorage)
 * - Upload: cắt file 45MB, đẩy tuần tự (UPLOAD_CONCURRENCY luồng), IndexedDB resume.
 * - Download: StreamSaver tuần tự không ngốn RAM.
 * - Xóa file lớn: bóc tách xóa từng part từ Frontend.
 * - UI Pro: search, sort cột, checkbox + bulk delete, clear-all, kebab menu (...),
 *   modal preview (ảnh / video / audio / pdf).
 */

// =========================================================
// TIÊM HIỆU ỨNG CHUYỂN ĐỘNG CHO NÚT
// =========================================================
(function injectButtonMotionCSS() {
    const style = document.createElement('style');
    style.innerHTML = `
        .btn, button {
            position: relative;
            overflow: hidden;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
            transform: scale(1);
            cursor: pointer;
        }
        .btn:hover, button:hover {
            transform: translateY(-2px) scale(1.02);
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
            filter: brightness(1.1);
        }
        .btn:active, button:active {
            transform: translateY(1px) scale(0.96) !important;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .btn-pulse-active {
            animation: btnPulseEffect 1.5s infinite ease-in-out;
        }
        @keyframes btnPulseEffect {
            0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.6); }
            70% { box-shadow: 0 0 0 10px rgba(37, 99, 235, 0); }
            100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
        }
        .btn-danger:hover {
            background-color: #dc2626 !important;
            animation: shakeDangerBtn 0.3s ease-in-out 1;
        }
        @keyframes shakeDangerBtn {
            0%, 100% { transform: translateX(0) translateY(-2px); }
            25% { transform: translateX(-2px) translateY(-2px); }
            75% { transform: translateX(2px) translateY(-2px); }
        }
        .action-cell { position: relative; }
        .action-menu {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            min-width: 160px;
            background: rgba(30, 41, 59, 0.95);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 10px;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            box-shadow: 0 12px 28px rgba(0,0,0,0.45);
            z-index: 50;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }
        .action-menu.open { display: flex; }
        .action-menu button {
            background: transparent;
            border: none;
            color: #f8fafc;
            text-align: left;
            padding: 10px 14px;
            font-size: 13px;
            font-weight: 500;
            border-radius: 0;
            width: 100%;
        }
        .action-menu button:hover {
            background: rgba(255,255,255,0.08);
            transform: none;
            box-shadow: none;
            filter: none;
        }
        .action-menu button.danger { color: #f87171; }
    `;
    document.head.appendChild(style);
})();

const PASSWORD = "140613";
const API = "https://drive-worker.phamdatt140613.workers.dev";
const AUTH_HEADER = "140613";

// Kích thước part mặc định (45MB)
const DEFAULT_PART_SIZE = 45 * 1024 * 1024;

// Số luồng tải lên đồng thời
const UPLOAD_CONCURRENCY = 1;

// Đuôi file hỗ trợ Preview
const PREVIEW_IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];
const PREVIEW_VIDEO_EXT = ["mp4", "webm", "ogg", "mov"];
const PREVIEW_AUDIO_EXT = ["mp3", "wav", "m4a", "aac"];
const PREVIEW_PDF_EXT = ["pdf"];

// =========================================================
// DOM REFERENCES
// =========================================================
const loginPage = document.querySelector("#login-page");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector(".login-form");
const passwordInput = document.querySelector(".password-input");
const uploadBtn = document.querySelector(".upload-btn");
const uploadInput = document.querySelector("#input-file");
const partSizeSelect = document.querySelector("#part-size");
const logoutBtn = document.querySelector(".logout-btn");
const fileTableBody = document.querySelector(".file-table-body");
const partTableBody = document.querySelector(".part-table-body");
const totalFiles = document.querySelector(".total-files");
const totalSize = document.querySelector(".total-size");
const usedSize = document.querySelector(".used-size");

const uploadManagerPanel = document.querySelector("#upload-manager-panel");
const uploadingFileName = document.querySelector(".uploading-file-name");
const uploadProgressBar = document.querySelector(".upload-progress-bar");
const uploadProgressText = document.querySelector(".upload-progress-text");
const managerUploadBar = document.querySelector(".manager-upload-progress-bar");
const uploadStatus = document.querySelector(".upload-status");
const currentPartText = document.querySelector(".current-part");
const uploadControls = document.querySelector("#upload-controls");
const btnPause = document.querySelector("#btn-pause");
const btnResume = document.querySelector("#btn-resume");

const downloadManagerPanel = document.querySelector("#download-manager-panel");
const downloadingFileName = document.querySelector(".downloading-file-name");
const downloadProgressBar = document.querySelector(".download-progress-bar");
const downloadStatus = document.querySelector(".download-status");

const detailsPanel = document.querySelector("#details-panel");
const detailId = document.querySelector(".detail-id");
const detailName = document.querySelector(".detail-name");
const detailSize = document.querySelector(".detail-size");
const detailParts = document.querySelector(".detail-parts");
const detailStatus = document.querySelector(".detail-status");

const logList = document.querySelector(".log-list");

const searchInput = document.querySelector("#search-input");
const selectAllCheckbox = document.querySelector("#select-all");
const bulkDeleteBtn = document.querySelector("#bulk-delete-btn");
const selectCountSpan = document.querySelector("#select-count");
const clearAllBtn = document.querySelector("#clear-all-storage-btn");

const previewModal = document.querySelector("#preview-modal");
const previewTitle = document.querySelector("#preview-title");
const previewBody = document.querySelector("#preview-body");

// =========================================================
// STATE
// =========================================================
let allFiles = [];
let sortKey = null;
let sortDir = 1; // 1 = asc, -1 = desc

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
// INIT / AUTH
// =========================================================
async function init() {
    await openDB();
    if (localStorage.getItem("drive_auth") === "1") {
        showDashboard();
    } else {
        showLogin();
    }
    checkPendingUpload();
}

function showLogin() {
    loginPage.style.display = "flex";
    dashboard.style.display = "none";
}

function showDashboard() {
    loginPage.style.display = "none";
    dashboard.style.display = "block";
    loadFiles();
}

loginForm.addEventListener("submit", e => {
    e.preventDefault();
    const pass = passwordInput.value.trim();
    if (pass === PASSWORD) {
        localStorage.setItem("drive_auth", "1");
        showDashboard();
    } else {
        alert("Sai khóa");
    }
});

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("drive_auth");
    location.reload();
});

// =========================================================
// INDEXEDDB
// =========================================================
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("tgdrive_db", 1);

        request.onupgradeneeded = () => {
            const idb = request.result;
            if (!idb.objectStoreNames.contains("upload_progress")) {
                idb.createObjectStore("upload_progress", {
                    keyPath: "sessionKey"
                });
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
        addLog(`Tìm thấy ${keys.length} tiến trình upload chưa hoàn tất. Chọn lại file gốc để Resume.`);
    }
}

// =========================================================
// UPLOAD
// =========================================================
uploadBtn.addEventListener("click", () => {
    // upload-btn chỉ mở dialog chọn file (onclick trong HTML),
    // việc bắt đầu upload thực sự diễn ra khi input change
});

uploadInput.addEventListener("change", () => {
    if (uploadState.file && !uploadState.paused && !uploadState.cancelled) {
        return;
    }
    startUpload();
});

if (btnPause) {
    btnPause.addEventListener("click", () => {
        uploadState.paused = true;
        if (uploadBtn) uploadBtn.classList.remove("btn-pulse-active");
        if (uploadStatus) uploadStatus.textContent = `Đã tạm dừng`;
        btnResume.style.display = "inline-block";
        btnPause.style.display = "none";
        addLog("Bấm tạm dừng tiến trình upload");
    });
}

if (btnResume) {
    btnResume.addEventListener("click", () => {
        if (!uploadState.file) {
            addLog("Chưa chọn file để resume. Vui lòng chọn lại file gốc.");
            return;
        }
        if (!uploadState.paused) return;

        uploadState.paused = false;
        if (uploadBtn) uploadBtn.classList.add("btn-pulse-active");
        btnResume.style.display = "none";
        btnPause.style.display = "inline-block";
        addLog("Tiếp tục upload");
        runUploadLoop();
    });
}

async function startUpload() {
    const file = uploadInput.files[0];

    if (!file) {
        addLog("Hệ thống: Chưa có tệp tin nào được chọn để tải lên.");
        return;
    }

    const partSizeMB = Number(partSizeSelect ? partSizeSelect.value : 45);
    const partSize = partSizeMB * 1024 * 1024;
    const sessionKey = `${file.name}_${file.size}`;

    let progress = await dbGet("upload_progress", sessionKey);
    const totalParts = Math.ceil(file.size / partSize);

    if (progress && progress.totalParts === totalParts) {
        addLog(`Phát hiện tiến trình cũ: đã xong ${progress.doneParts.length}/${totalParts} part. Đang tiếp tục...`);
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

    uploadControls.style.display = "flex";
    btnResume.style.display = "none";
    btnPause.style.display = "inline-block";
    if (uploadBtn) uploadBtn.classList.add("btn-pulse-active");

    addLog("Bắt đầu upload: " + file.name);
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

                addLog(`Upload part ${partIndex}/${totalParts} thành công`);
                updateUploadUI(progress.doneParts.length, totalParts);

            } catch (err) {
                console.error(err);
                pendingPartsQueue.unshift(partIndex);
                if (uploadStatus) uploadStatus.textContent = `Lỗi tại Part ${partIndex}. Tạm hoãn.`;
                addLog(`Lỗi luồng Part ${partIndex}: ${err.message || err}`);

                uploadState.paused = true;
                btnResume.style.display = "inline-block";
                btnPause.style.display = "none";
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
        if (uploadStatus) uploadStatus.textContent = "Hoàn tất";
        if (currentPartText) currentPartText.textContent = `Đã xong ${totalParts}/${totalParts} part`;

        uploadControls.style.display = "none";
        if (uploadBtn) uploadBtn.classList.remove("btn-pulse-active");

        await dbDelete("upload_progress", uploadState.sessionKey);
        addLog("Upload hoàn thành: " + uploadState.file.name);

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
    const percent = totalParts > 0 ? Math.round((doneCount / totalParts) * 100) : 0;

    if (uploadProgressBar) uploadProgressBar.style.width = percent + "%";
    if (managerUploadBar) managerUploadBar.style.width = percent + "%";
    if (uploadProgressText) uploadProgressText.textContent = percent + "%";
    if (uploadStatus) uploadStatus.textContent = `${percent}%`;
    if (currentPartText) currentPartText.textContent = `Đã xong ${doneCount}/${totalParts} part`;
}

// =========================================================
// LOAD FILES
// =========================================================
async function loadFiles() {
    try {
        const response = await fetch(API + "/files", { headers: { "Authorization": AUTH_HEADER } });
        const files = await response.json();
        if (!Array.isArray(files)) { console.error(files); return; }
        allFiles = files;
        renderFiles();
    } catch (error) {
        console.error(error);
        addLog("Không tải được danh sách file");
    }
}

// =========================================================
// SEARCH + SORT + RENDER
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
            let va = a[sortKey];
            let vb = b[sortKey];

            if (sortKey === "name") {
                va = (va || "").toLowerCase();
                vb = (vb || "").toLowerCase();
                return va.localeCompare(vb) * sortDir;
            }

            va = Number(va || 0);
            vb = Number(vb || 0);
            return (va - vb) * sortDir;
        });
    }

    return files;
}

function renderFiles() {
    const files = getFilteredSortedFiles();

    fileTableBody.innerHTML = "";

    let totalBytes = 0;
    allFiles.forEach(f => totalBytes += Number(f.size || 0));

    files.forEach(file => {
        const tr = document.createElement("tr");
        tr.dataset.id = file.id;

        tr.innerHTML = `
        <td><input type="checkbox" class="row-check" data-id="${file.id}"></td>
        <td>
            <span class="file-name-cell" title="${escapeHtml(file.name || "")}">${escapeHtml(file.name || "-")}</span>
        </td>
        <td>${formatSize(file.size || 0)}</td>
        <td>${formatDate(file.created_at)}</td>
        <td class="action-cell" style="text-align:right;">
            <button class="action-dots" data-id="${file.id}">&#8942;</button>
            <div class="action-menu" data-menu-for="${file.id}">
                ${canPreviewFile(file) ? `<button data-action="preview" data-id="${file.id}">👁 Xem trước</button>` : ""}
                <button data-action="details" data-id="${file.id}">ℹ Chi tiết</button>
                <button data-action="download" data-id="${file.id}">⬇ Tải xuống</button>
                <button class="danger" data-action="delete" data-id="${file.id}">🗑 Xóa</button>
            </div>
        </td>
        `;

        fileTableBody.appendChild(tr);
    });

    totalFiles.textContent = allFiles.length;
    totalSize.textContent = formatSize(totalBytes);

    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateSelectCount();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// =========================================================
// ACTION DOTS (KEBAB MENU)
// =========================================================
document.addEventListener("click", e => {
    const dots = e.target.closest(".action-dots");

    // đóng tất cả menu trước
    document.querySelectorAll(".action-menu.open").forEach(m => {
        if (!dots || m.dataset.menuFor !== dots.dataset.id) {
            m.classList.remove("open");
        }
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
// CHECKBOX SELECT-ALL + BULK DELETE
// =========================================================
if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", () => {
        document.querySelectorAll(".row-check").forEach(cb => {
            cb.checked = selectAllCheckbox.checked;
        });
        updateSelectCount();
    });
}

fileTableBody.addEventListener("change", e => {
    if (e.target.classList.contains("row-check")) {
        updateSelectCount();
    }
});

function updateSelectCount() {
    const checked = document.querySelectorAll(".row-check:checked");
    if (selectCountSpan) selectCountSpan.textContent = checked.length;
    if (bulkDeleteBtn) {
        bulkDeleteBtn.style.display = checked.length > 0 ? "inline-flex" : "none";
    }
}

if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener("click", async () => {
        const checked = Array.from(document.querySelectorAll(".row-check:checked"));
        if (checked.length === 0) return;

        if (!confirm(`Xóa ${checked.length} file đã chọn?`)) return;

        for (const cb of checked) {
            const id = cb.dataset.id;
            await deleteFileSilently(id);
        }

        loadFiles();
    });
}

if (clearAllBtn) {
    clearAllBtn.addEventListener("click", async () => {
        if (allFiles.length === 0) {
            addLog("Kho lưu trữ đang trống.");
            return;
        }

        if (!confirm(`XÓA SẠCH toàn bộ ${allFiles.length} file trong kho? Hành động này không thể hoàn tác.`)) return;

        addLog("Bắt đầu xóa sạch toàn bộ kho...");

        for (const file of allFiles.slice()) {
            await deleteFileSilently(file.id);
        }

        addLog("Đã xóa sạch toàn bộ kho.");
        loadFiles();
    });
}

// =========================================================
// FILE DETAILS
// =========================================================
async function showDetails(id) {
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const file = await response.json();

        if (detailsPanel) detailsPanel.style.display = "block";

        if (detailId) detailId.textContent = "ID: " + (file.id || "-");
        if (detailName) detailName.textContent = "Tên: " + (file.name || "-");
        if (detailSize) detailSize.textContent = "Dung lượng: " + formatSize(file.size || 0);
        if (detailParts) detailParts.textContent = "Part Count: " + (file.part_count || 1);
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
        addLog("Lỗi tải chi tiết file: " + (error.message || error));
    }
}

// =========================================================
// DELETE FILE (xóa từng part rồi xóa metadata)
// =========================================================
async function deleteFileSilently(id) {
    addLog(`[Xóa] Bắt đầu quét thông tin cấu trúc tệp tin ID: ${id}`);

    try {
        const responseDetails = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const fileMeta = await responseDetails.json();
        const totalParts = fileMeta.part_count || (fileMeta.parts ? fileMeta.parts.length : 1);

        addLog(`[Xóa] Phát hiện file "${fileMeta.name || id}" có tổng cộng ${totalParts} part.`);

        for (let partIndex = 1; partIndex <= totalParts; partIndex++) {
            addLog(`[Xóa] Đang xóa Part ${partIndex}/${totalParts}...`);
            await fetch(`${API}/file/${id}?part=${partIndex}&part_index=${partIndex}`, {
                method: "DELETE",
                headers: { "Authorization": AUTH_HEADER }
            });
        }

        const finalDeleteRes = await fetch(API + "/file/" + id, {
            method: "DELETE",
            headers: { "Authorization": AUTH_HEADER }
        });

        if (finalDeleteRes.ok) {
            addLog(`[Thành công] Đã xóa: ${fileMeta.name || id}`);
        } else {
            addLog(`[Cảnh báo] Phản hồi xóa: ${finalDeleteRes.status}`);
        }

    } catch (error) {
        console.error("Lỗi xóa theo part:", error);
        addLog(`[Lỗi] Xóa theo part thất bại: ${error.message}. Thử xóa trực tiếp...`);

        try {
            await fetch(API + "/file/" + id, { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
            addLog("[Xóa] Đã gửi lệnh xóa trực tiếp.");
        } catch (fallbackError) {
            addLog(`[Thất bại] Không thể xóa: ${fallbackError.message}`);
        }
    }
}

async function deleteFile(id) {
    if (!confirm("Bạn chắc chắn muốn xóa file này và TẤT CẢ các Part liên quan trên Telegram chứ?")) return;

    const dots = document.querySelector(`.action-dots[data-id="${id}"]`);
    if (dots) dots.classList.add("btn-pulse-active");

    await deleteFileSilently(id);

    if (dots) dots.classList.remove("btn-pulse-active");

    loadFiles();
}

// =========================================================
// PREVIEW MODAL
// =========================================================
function getExt(name) {
    const dot = (name || "").lastIndexOf(".");
    if (dot === -1) return "";
    return name.slice(dot + 1).toLowerCase().split(".part")[0];
}

function canPreviewFile(file) {
    const ext = getExt(file.name);
    const isMedia =
        PREVIEW_IMAGE_EXT.includes(ext) ||
        PREVIEW_VIDEO_EXT.includes(ext) ||
        PREVIEW_AUDIO_EXT.includes(ext) ||
        PREVIEW_PDF_EXT.includes(ext);

    return isMedia && (file.part_count || 1) <= 1;
}

async function previewFile(id) {
    if (!previewModal) return;

    previewTitle.textContent = "Đang tải xem trước...";
    previewBody.innerHTML = `<p style="color:#94a3b8;">Đang tải dữ liệu...</p>`;
    previewModal.style.display = "flex";

    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const file = await response.json();

        if (!file || !Array.isArray(file.parts) || file.parts.length !== 1) {
            previewBody.innerHTML = `<p style="color:#94a3b8;">File không hỗ trợ xem trước (nhiều part).</p>`;
            previewTitle.textContent = file.name || "Xem trước";
            return;
        }

        const part = file.parts[0];
        const ext = getExt(file.name);

        previewTitle.textContent = file.name || "Xem trước";

        const mediaResponse = await fetch(API + "/download/" + part.file_id, {
            headers: { "Authorization": AUTH_HEADER }
        });

        if (!mediaResponse.ok || !mediaResponse.body) {
            previewBody.innerHTML = `<p style="color:#94a3b8;">Không tải được dữ liệu xem trước.</p>`;
            return;
        }

        const blob = await mediaResponse.blob();
        const objectUrl = URL.createObjectURL(blob);

        if (PREVIEW_IMAGE_EXT.includes(ext)) {
            previewBody.innerHTML = `<img src="${objectUrl}" alt="${escapeHtml(file.name)}">`;
        } else if (PREVIEW_VIDEO_EXT.includes(ext)) {
            previewBody.innerHTML = `<video src="${objectUrl}" controls autoplay></video>`;
        } else if (PREVIEW_AUDIO_EXT.includes(ext)) {
            previewBody.innerHTML = `<audio src="${objectUrl}" controls autoplay></audio>`;
        } else if (PREVIEW_PDF_EXT.includes(ext)) {
            const pdfBlob = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
            const pdfUrl = URL.createObjectURL(pdfBlob);
            previewBody.innerHTML = `<iframe src="${pdfUrl}"></iframe>`;
        } else {
            previewBody.innerHTML = `<p style="color:#94a3b8;">Định dạng không hỗ trợ xem trước.</p>`;
        }

    } catch (error) {
        console.error(error);
        previewBody.innerHTML = `<p style="color:#94a3b8;">Lỗi khi tải xem trước.</p>`;
    }
}

window.closePreview = function() {
    if (!previewModal) return;

    previewModal.style.display = "none";

    const media = previewBody.querySelector("img, video, audio, iframe");
    if (media) {
        const src = media.tagName === "IFRAME" ? media.src : media.src;
        if (src && src.startsWith("blob:")) {
            URL.revokeObjectURL(src);
        }
    }

    previewBody.innerHTML = "";
};

if (previewModal) {
    previewModal.addEventListener("click", e => {
        if (e.target === previewModal) closePreview();
    });
}

// =========================================================
// DOWNLOAD - STREAMSAVER TUẦN TỰ KHÔNG NGỐN RAM
// =========================================================
async function downloadFile(id) {
    addLog("Bắt đầu download: " + id);

    let fileMeta;
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        fileMeta = await response.json();
    } catch (error) {
        console.error(error);
        if (downloadStatus) downloadStatus.textContent = "Lỗi: không lấy được metadata";
        return;
    }

    if (!fileMeta || !Array.isArray(fileMeta.parts) || fileMeta.parts.length === 0) {
        addLog("File không có dữ liệu part để tải");
        return;
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

    try {
        for (let i = 0; i < totalParts; i++) {
            const part = parts[i];
            const response = await fetch(API + "/download/" + part.file_id, { headers: { "Authorization": AUTH_HEADER } });

            if (!response.ok || !response.body) { throw new Error(`Không tải được part ${i + 1}`); }
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
            addLog(`Đã tải xong part ${i + 1}/${totalParts}`);
        }
        await writer.close();
        if (downloadProgressBar) downloadProgressBar.style.width = "100%";
        if (downloadStatus) downloadStatus.textContent = "Hoàn tất";
        addLog("Download hoàn tất: " + (fileMeta.name || id));

        setTimeout(() => {
            if (downloadManagerPanel) downloadManagerPanel.style.display = "none";
        }, 1500);

    } catch (error) {
        console.error(error);
        if (downloadStatus) downloadStatus.textContent = "Lỗi: " + (error.message || error);
        addLog("Download lỗi: " + (error.message || error));
        try { await writer.abort(); } catch (e) {}
    }
}

// =========================================================
// UTILS
// =========================================================
function addLog(text) {
    const li = document.createElement("li");
    li.className = "log-item";
    li.textContent = new Date().toLocaleTimeString() + " - " + text;
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
