/**
 * TG-Drive Frontend Logic - PHIÊN BẢN HOÀN CHỈNH SIÊU CẤP V3
 * -----------------------------------------------------------------
 * - Đăng nhập bằng mật khẩu tĩnh (lưu LocalStorage)
 * - Tối ưu Upload: Cắt file 45MB, ĐẨY SONG SONG 3 LUỒNG cùng lúc.
 * - IndexedDB: Khóa đồng bộ tiến trình đa luồng chống xung đột Race Condition.
 * - Download: StreamSaver tuần tự không ngốn RAM.
 * - Giải quyết lỗi xóa file lớn: Tự động bóc tách và xóa tuần tự từng Part từ Frontend chống Worker Timeout.
 * - Không sử dụng alert phiền toái khi chưa chọn file.
 */

// =========================================================
// TIÊM HIỆU ỨNG CHUYỂN ĐỘNG CHO NÚT (BUTTON MOTION INTERACTIONS)
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
    `;
    document.head.appendChild(style);
})();

const PASSWORD = "140613";
const API = "https://drive-worker.phamdatt140613.workers.dev";
const AUTH_HEADER = "140613";

// NÂNG KÍCH THƯỚC TRẦN MẶC ĐỊNH LÊN 45MB ĐỂ GIẢM SỐ LƯỢNG HTTP REQUEST
const DEFAULT_PART_SIZE = 45 * 1024 * 1024;

// ĐỊNH NGHĨA SỐ LUỒNG TẢI LÊN ĐỒNG THỜI CÙNG LÚC
const UPLOAD_CONCURRENCY = 1;

// =========================================================
// DOM REFERENCES
// =========================================================
const loginPage = document.querySelector("#login-page");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector(".login-form");
const passwordInput = document.querySelector(".password-input");
const uploadBtn = document.querySelector(".upload-btn");
const uploadInput = document.querySelector(".input-file");
const partSizeSelect = document.querySelector("#part-size");
const logoutBtn = document.querySelector(".logout-btn");
const fileTableBody = document.querySelector(".file-table-body");
const partTableBody = document.querySelector(".part-table-body");
const totalFiles = document.querySelector(".total-files");
const totalSize = document.querySelector(".total-size");
const usedSize = document.querySelector(".used-size");
const uploadProgressBar = document.querySelector(".upload-progress-bar");
const uploadProgressText = document.querySelector(".upload-progress-text");
const managerUploadBar = document.querySelector(".manager-upload-progress-bar");
const uploadStatus = document.querySelector(".upload-status");
const currentPartText = document.querySelector(".current-part");
const uploadControls = document.querySelector("#upload-controls");
const btnPause = document.querySelector("#btn-pause");
const btnResume = document.querySelector("#btn-resume");
const downloadProgressBar = document.querySelector(".download-progress-bar");
const downloadStatus = document.querySelector(".download-status");
const detailId = document.querySelector(".detail-id");
const detailName = document.querySelector(".detail-name");
const detailSize = document.querySelector(".detail-size");
const detailParts = document.querySelector(".detail-parts");
const detailStatus = document.querySelector(".detail-status");
const logList = document.querySelector(".log-list");

// =========================================================
// STATE
// =========================================================
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
                idb.createObjectStore("upload_progress", { keyPath: "sessionKey" });
            }
        };
        request.onsuccess = () => { db = request.result; resolve(db); };
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
// UPLOAD - ENGINE SONG SONG ĐA LUỒNG
// =========================================================
uploadBtn.addEventListener("click", () => {
    if (uploadState.paused === false && uploadState.file && !uploadState.cancelled) {
        return;
    }
    startUpload();
});

btnPause.addEventListener("click", () => {
    uploadState.paused = true;
    uploadBtn.classList.remove("btn-pulse-active");
    uploadStatus.textContent = `Đang hoãn... Đã lưu tạm bộ gộp part.`;
    addLog("Bấm tạm dừng tiến trình upload");
});

btnResume.addEventListener("click", () => {
    if (!uploadState.file) {
        alert("Chưa chọn file để resume. Vui lòng chọn lại file gốc.");
        return;
    }
    if (!uploadState.paused) return;

    uploadState.paused = false;
    uploadBtn.classList.add("btn-pulse-active");
    addLog("Tiếp tục tăng tốc luồng upload");
    runUploadLoop();
});

async function startUpload() {
    const file = uploadInput.files[0];

    // GIỮ NGUYÊN: BỎ ALERT PHIỀN TOÁI KHI CHƯA CHỌN FILE
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
        addLog(`Phát hiện tiến trình cũ: đã xong ${progress.doneParts.length}/${totalParts} part. Đang tăng tốc...`);
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

    uploadControls.style.display = "flex";
    btnResume.style.display = "none";
    btnPause.style.display = "inline-block";
    uploadBtn.classList.add("btn-pulse-active"); 

    addLog("Bắt đầu mở pool luồng song song cho: " + file.name);
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
                uploadStatus.textContent = `Gặp sự cố kết nối tại Part ${partIndex}. Đang tạm hoãn luồng...`;
                addLog(`Lỗi luồng Part ${partIndex}: ${err.message || err}`);
                
                uploadState.paused = true;
                btnResume.style.display = "inline-block";
                btnPause.style.display = "none";
                uploadBtn.classList.remove("btn-pulse-active");
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
        uploadProgressBar.style.width = "100%";
        managerUploadBar.style.width = "100%";
        uploadProgressText.textContent = "100%";
        uploadStatus.textContent = "Hoàn tất";
        currentPartText.textContent = `Part hiện tại: ${totalParts}/${totalParts}`;
        uploadControls.style.display = "none";
        uploadBtn.classList.remove("btn-pulse-active");

        await dbDelete("upload_progress", uploadState.sessionKey);
        addLog("Siêu tốc upload hoàn thành: " + uploadState.file.name);
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

    if (meta.fileId) { form.append("file_id", meta.fileId); }

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
    uploadProgressBar.style.width = percent + "%";
    managerUploadBar.style.width = percent + "%";
    uploadProgressText.textContent = percent + "%";
    uploadStatus.textContent = `Đang đẩy song song: đã xong ${doneCount}/${totalParts} part (${percent}%)`;
    currentPartText.textContent = `Xử lý thành công: ${doneCount}/${totalParts} part`;
}

// =========================================================
// LOAD FILES / DETAILS
// =========================================================
async function loadFiles() {
    try {
        const response = await fetch(API + "/files", { headers: { "Authorization": AUTH_HEADER } });
        const files = await response.json();
        if (!Array.isArray(files)) { console.error(files); return; }
        renderFiles(files);
    } catch (error) { console.error(error); addLog("Không tải được danh sách file"); }
}

function renderFiles(files) {
    fileTableBody.innerHTML = "";
    let totalBytes = 0;

    files.forEach(file => {
        totalBytes += Number(file.size || 0);
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${file.id || "-"}</td>
        <td style="font-weight:500;">${file.name || "-"}</td>
        <td>${formatSize(file.size || 0)}</td>
        <td>${file.part_count || 1}</td>
        <td>${formatDate(file.created_at)}</td>
        <td><span class="badge ${file.status === "uploaded" ? "badge-success" : "badge-warning"}">${file.status || "uploaded"}</span></td>
        <td class="actions">
            <button class="btn btn-secondary" onclick="showDetails('${file.id}')">Details</button>
            <button class="btn btn-success" onclick="downloadFile('${file.id}')">Download</button>
            <button class="btn btn-danger" onclick="deleteFile('${file.id}')">Delete</button>
        </td>
        `;
        fileTableBody.appendChild(tr);
    });
    totalFiles.textContent = files.length;
    totalSize.textContent = formatSize(totalBytes);
    usedSize.textContent = formatSize(totalBytes);
}

window.showDetails = async function(id) {
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const file = await response.json();
        detailId.textContent = "ID: " + (file.id || "-");
        detailName.textContent = "Tên: " + (file.name || "-");
        detailSize.textContent = "Dung lượng: " + formatSize(file.size || 0);
        detailParts.textContent = "Part Count: " + (file.part_count || 1);
        detailStatus.textContent = "Trạng thái: " + (file.status || "-");

        partTableBody.innerHTML = "";
        if (Array.isArray(file.parts)) {
            file.parts.forEach(part => {
                const row = document.createElement("tr");
                row.innerHTML = `<td>${part.index}</td><td>${part.name}</td><td>${part.file_id}</td><td>${part.message_id}</td>`;
                partTableBody.appendChild(row);
            });
        }
    } catch (error) { console.error(error); }
};

// =========================================================
// SỬA ĐỔI QUAN TRỌNG: XÓA FILE LỚN THEO TỪNG PART TỪ FRONTEND
// =========================================================
window.deleteFile = async function(id) {
    if (!confirm("Bạn chắc chắn muốn xóa file này và TẤT CẢ các Part liên quan trên Telegram chứ?")) return;
    
    const targetBtn = document.querySelector(`button[onclick*="${id}"]`);
    if (targetBtn) targetBtn.classList.add("btn-pulse-active");

    addLog(`[Xóa] Bắt đầu quét thông tin cấu trúc tệp tin ID: ${id}`);

    try {
        // Bước 1: Gọi API chi tiết để lấy tổng số part của file lớn này
        const responseDetails = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        const fileMeta = await responseDetails.json();
        const totalParts = fileMeta.part_count || (fileMeta.parts ? fileMeta.parts.length : 1);

        addLog(`[Xóa] Phát hiện file "${fileMeta.name || id}" có tổng cộng ${totalParts} part.`);

        // Bước 2: Vòng lặp phát lệnh xóa tuần tự từng part một, tránh làm Worker dính lỗi Timeout
        for (let partIndex = 1; partIndex <= totalParts; partIndex++) {
            addLog(`[Xóa] Đang tiến hành xóa dọn dẹp dữ liệu Part ${partIndex}/${totalParts}...`);
            
            // Gửi query parameter chỉ định rõ part cần xóa cho Worker xử lý nhẹ nhàng gọn gàng
            await fetch(`${API}/file/${id}?part=${partIndex}&part_index=${partIndex}`, {
                method: "DELETE",
                headers: { "Authorization": AUTH_HEADER }
            });
        }

        // Bước 3: Gửi lệnh xóa gốc cuối cùng để xóa bản ghi metadata trong Database của Worker
        addLog("[Xóa] Đang giải phóng bản ghi dữ liệu tệp tin gốc khỏi hệ thống...");
        const finalDeleteRes = await fetch(API + "/file/" + id, {
            method: "DELETE",
            headers: { "Authorization": AUTH_HEADER }
        });

        if (finalDeleteRes.ok) {
            addLog(`[Thành công] Đã xóa sạch 100% tệp tin và các Part liên quan: ${fileMeta.name || id}`);
        } else {
            addLog(`[Cảnh báo] Bản ghi dữ liệu cuối phản hồi mã: ${finalDeleteRes.status}`);
        }
        
        loadFiles();
    } catch (error) {
        console.error("Lỗi trong quá trình xử lý xóa theo part:", error);
        addLog(`[Lỗi] Xóa theo part thất bại: ${error.message}. Thử cấu hình xóa cưỡng chế bản ghi gốc...`);
        
        // Cơ chế dự phòng (Fallback): Gửi lệnh xóa thẳng tệp nếu bước lấy thông tin part bị lỗi
        try {
            await fetch(API + "/file/" + id, { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
            addLog("[Xóa] Đã gửi lệnh dọn dẹp trực tiếp.");
            loadFiles();
        } catch (fallbackError) {
            addLog(`[Thất bại hoàn toàn] Không thể xóa: ${fallbackError.message}`);
        }
    } finally {
        if (targetBtn) targetBtn.classList.remove("btn-pulse-active");
    }
};

// =========================================================
// DOWNLOAD - STREAMSAVER TUẦN TỰ KHÔNG NGỐN RAM
// =========================================================
window.downloadFile = async function(id) {
    const targetBtn = document.querySelector(`button[onclick*="${id}"]`);
    if (targetBtn) targetBtn.classList.add("btn-pulse-active");

    addLog("Bắt đầu download: " + id);
    let fileMeta;
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": AUTH_HEADER } });
        fileMeta = await response.json();
    } catch (error) {
        console.error(error);
        downloadStatus.textContent = "Lỗi: không lấy được metadata";
        if (targetBtn) targetBtn.classList.remove("btn-pulse-active");
        return;
    }

    if (!fileMeta || !Array.isArray(fileMeta.parts) || fileMeta.parts.length === 0) {
        alert("File không có dữ liệu part để tải");
        if (targetBtn) targetBtn.classList.remove("btn-pulse-active");
        return;
    }

    const parts = fileMeta.parts.slice().sort((a, b) => a.index - b.index);
    const totalParts = parts.length;
    const fileStream = streamSaver.createWriteStream(fileMeta.name || "download.bin", { size: fileMeta.size || undefined });
    const writer = fileStream.getWriter();

    downloadProgressBar.style.width = "0%";
    downloadStatus.textContent = `Đang tải part 1/${totalParts}...`;

    let totalDownloaded = 0;
    const totalSizeBytes = Number(fileMeta.size || 0);

    try {
        for (let i = 0; i < totalParts; i++) {
            const part = parts[i];
            downloadStatus.textContent = `Đang tải part ${i + 1}/${totalParts} (${part.name})`;
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
                    downloadProgressBar.style.width = percent + "%";
                    downloadStatus.textContent = `Đang tải: ${percent}% (Part ${i + 1}/${totalParts})`;
                }
            }
            addLog(`Đã tải xong part ${i + 1}/${totalParts}`);
        }
        await writer.close();
        downloadProgressBar.style.width = "100%";
        downloadStatus.textContent = "Hoàn tất download";
        addLog("Download hoàn tất: " + (fileMeta.name || id));
    } catch (error) {
        console.error(error);
        downloadStatus.textContent = "Lỗi download: " + (error.message || error);
        addLog("Download lỗi: " + (error.message || error));
        try { await writer.abort(); } catch (e) {}
    } finally {
        if (targetBtn) targetBtn.classList.remove("btn-pulse-active");
    }
};

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
