/**
 * TG-Drive Frontend Logic
 * ------------------------
 * - Đăng nhập bằng mật khẩu tĩnh (lưu LocalStorage)
 * - Upload: cắt file thành các PART <= PART_SIZE (mặc định 40MB) bằng file.slice(),
 *   gửi từng part dạng RAW BINARY (KHÔNG dùng FormData) lên Worker, có Pause/Resume.
 * - IndexedDB: lưu tiến trình upload (part nào đã xong) để Resume sau khi mất mạng / reload.
 * - Download: dùng StreamSaver.js, đọc tuần tự từng part từ Worker (/download/:file_id)
 *   và pipe thẳng xuống ổ cứng, không gom vào RAM.
 */

const PASSWORD = "140613";

// Đổi thành URL Worker thật của bạn
const API = "https://drive-worker.phamdatt140613.workers.dev";

// Mọi request đều phải kèm header Authorization khớp AUTH_KEY trên Worker
const AUTH_HEADER = "140613";

// Kích thước mỗi part (bytes) - mặc định 40MB, có thể đổi qua <select id="part-size">
const DEFAULT_PART_SIZE = 40 * 1024 * 1024;

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
    file: null,        // File object hiện tại đang upload
    fileId: "",         // ID file logic do Worker cấp (rỗng cho tới khi part đầu tiên xong)
    partSize: DEFAULT_PART_SIZE,
    totalParts: 0,
    currentPart: 1,
    paused: false,
    cancelled: false,
    sessionKey: ""      // key để lưu tiến trình trong IndexedDB (name+size)
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

    // Nếu có session upload chưa hoàn thành -> hỏi resume khi mở dashboard
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
// INDEXEDDB - lưu tiến trình Upload/Download để Resume
// =========================================================

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("tgdrive_db", 1);

        request.onupgradeneeded = () => {
            const idb = request.result;

            if (!idb.objectStoreNames.contains("upload_progress")) {
                // key: sessionKey (name_size), value: { fileId, partSize, totalParts, doneParts: [1,2,...], name, size }
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
        addLog(`Tìm thấy ${keys.length} tiến trình upload chưa hoàn tất. Chọn lại file gốc để Resume.`);
    }
}

// =========================================================
// UPLOAD - cắt file thành part 40MB và gửi tuần tự
// =========================================================

uploadBtn.addEventListener("click", () => {
    if (uploadState.paused === false && uploadState.file && !uploadState.cancelled) {
        // Đang có 1 upload chạy -> bấm nút này không làm gì thêm
        return;
    }
    startUpload();
});

btnPause.addEventListener("click", () => {
    uploadState.paused = true;
    uploadStatus.textContent = `Đã tạm dừng tại part ${uploadState.currentPart}/${uploadState.totalParts}`;
    addLog("Tạm dừng upload");
});

btnResume.addEventListener("click", () => {
    if (!uploadState.file) {
        alert("Chưa chọn file để resume. Vui lòng chọn lại file gốc.");
        return;
    }
    if (!uploadState.paused) return;

    uploadState.paused = false;
    addLog("Tiếp tục upload");
    runUploadLoop();
});

async function startUpload() {
    const file = uploadInput.files[0];

    if (!file) {
        alert("Chọn file");
        return;
    }

    const partSizeMB = Number(partSizeSelect ? partSizeSelect.value : 40);
    const partSize = partSizeMB * 1024 * 1024;

    const sessionKey = `${file.name}_${file.size}`;

    // Kiểm tra IndexedDB xem có tiến trình cũ chưa hoàn tất không -> resume
    let progress = await dbGet("upload_progress", sessionKey);

    const totalParts = Math.ceil(file.size / partSize);

    if (progress && progress.totalParts === totalParts) {
        addLog(`Phát hiện tiến trình cũ: đã xong ${progress.doneParts.length}/${totalParts} part. Tiếp tục từ đó.`);
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
        currentPart: 1,
        paused: false,
        cancelled: false,
        sessionKey
    };

    uploadControls.style.display = "flex";
    btnResume.style.display = "none";
    btnPause.style.display = "inline-block";

    addLog("Bắt đầu upload: " + file.name);

    runUploadLoop();
}

/**
 * Vòng lặp upload tuần tự từng part.
 * - Dùng file.slice() để tạo Blob nhỏ cho từng part (không load cả file vào RAM).
 * - Bỏ qua part đã có trong IndexedDB.doneParts (resume).
 * - Sau mỗi part thành công -> ghi vào IndexedDB.
 */
async function runUploadLoop() {

    const progress = await dbGet("upload_progress", uploadState.sessionKey);
    if (!progress) return;

    const { file, partSize, totalParts } = uploadState;

    for (let partIndex = 1; partIndex <= totalParts; partIndex++) {

        if (uploadState.paused || uploadState.cancelled) {
            return;
        }

        // Bỏ qua part đã upload xong (resume)
        if (progress.doneParts.includes(partIndex)) {
            uploadState.currentPart = partIndex;
            updateUploadUI(partIndex, totalParts);
            continue;
        }

        uploadState.currentPart = partIndex;
        updateUploadUI(partIndex, totalParts);

        const start = (partIndex - 1) * partSize;
        const end = Math.min(start + partSize, file.size);

        // file.slice() chỉ tạo "view" trên file, KHÔNG đọc dữ liệu vào RAM ngay
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

            // Lần đầu Worker trả về fileId mới -> lưu lại để các part sau dùng chung
            if (!uploadState.fileId && result.file_id) {
                uploadState.fileId = result.file_id;
                progress.fileId = result.file_id;
            }

            progress.doneParts.push(partIndex);
            progress.doneParts.sort((a, b) => a - b);
            await dbPut("upload_progress", progress);

            addLog(`Upload part ${partIndex}/${totalParts} thành công`);

        } catch (err) {
            console.error(err);
            uploadStatus.textContent = `Lỗi upload tại part ${partIndex}, đang tạm dừng. Bấm Tiếp Tục để thử lại.`;
            addLog(`Lỗi upload part ${partIndex}: ${err.message || err}`);
            uploadState.paused = true;
            return;
        }
    }

    // Hoàn tất toàn bộ
    uploadProgressBar.style.width = "100%";
    managerUploadBar.style.width = "100%";
    uploadProgressText.textContent = "100%";
    uploadStatus.textContent = "Hoàn tất";
    currentPartText.textContent = `Part hiện tại: ${totalParts}/${totalParts}`;

    uploadControls.style.display = "none";

    await dbDelete("upload_progress", uploadState.sessionKey);

    addLog("Upload hoàn tất: " + uploadState.file.name);

    loadFiles();
}

/**
 * Gửi 1 part dưới dạng RAW BINARY (body = Blob) tới Worker.
 * Metadata được truyền qua header để Worker không cần parse multipart.
 */
async function uploadPart(blob, meta) {

    const form = new FormData();

    form.append(
        "file",
        new File(
            [blob],
            `${meta.fileName}.part${meta.partIndex}`,
            {
                type: meta.mimeType || "application/octet-stream"
            }
        )
    );

    form.append(
        "original_name",
        meta.fileName
    );

    form.append(
        "original_size",
        String(meta.fileSize)
    );

    form.append(
        "part_index",
        String(meta.partIndex)
    );

    form.append(
        "part_count",
        String(meta.totalParts)
    );

    form.append(
        "mime_type",
        meta.mimeType || "application/octet-stream"
    );

    if (meta.fileId) {

        form.append(
            "file_id",
            meta.fileId
        );

    }

    const response = await fetch(
        API + "/upload",
        {
            method: "POST",
            headers: {
                Authorization: AUTH_HEADER
            },
            body: form
        }
    );

    if (!response.ok) {

        const errData =
        await response
            .json()
            .catch(() => ({}));

        throw new Error(
            errData.error ||
            `HTTP ${response.status}`
        );

    }

    return response.json();

}
function updateUploadUI(partIndex, totalParts) {
    const percent = Math.round(((partIndex - 1) / totalParts) * 100);

    uploadProgressBar.style.width = percent + "%";
    managerUploadBar.style.width = percent + "%";
    uploadProgressText.textContent = percent + "%";
    uploadStatus.textContent = `Đang upload part ${partIndex}/${totalParts} (${percent}%)`;
    currentPartText.textContent = `Part hiện tại: ${partIndex}/${totalParts}`;
}

// =========================================================
// LOAD FILES
// =========================================================

async function loadFiles() {

    try {

        const response = await fetch(API + "/files", {
            headers: { "Authorization": AUTH_HEADER }
        });

        const files = await response.json();

if (!Array.isArray(files)) {

    console.error(files);

    return;

}

renderFiles(files);

    } catch (error) {

        console.error(error);

        addLog("Không tải được danh sách file");

    }

}

function renderFiles(files) {

    fileTableBody.innerHTML = "";

    let totalBytes = 0;

    files.forEach(file => {

        totalBytes += Number(file.size || 0);

        const tr = document.createElement("tr");

        tr.innerHTML = `
        <td>${file.id || "-"}</td>
        <td>${file.name || "-"}</td>
        <td>${formatSize(file.size || 0)}</td>
        <td>${file.part_count || 1}</td>
        <td>${formatDate(file.created_at)}</td>
        <td>
            <span class="badge ${file.status === "uploaded" ? "badge-success" : "badge-warning"}">
                ${file.status || "uploaded"}
            </span>
        </td>
        <td class="actions">

            <button
                class="btn btn-secondary"
                onclick="showDetails('${file.id}')"
            >
                Details
            </button>

            <button
                class="btn btn-success"
                onclick="downloadFile('${file.id}')"
            >
                Download
            </button>

            <button
                class="btn btn-danger"
                onclick="deleteFile('${file.id}')"
            >
                Delete
            </button>

        </td>
        `;

        fileTableBody.appendChild(tr);

    });

    totalFiles.textContent = files.length;

    totalSize.textContent = formatSize(totalBytes);

    usedSize.textContent = formatSize(totalBytes);

}

// =========================================================
// FILE DETAILS
// =========================================================

window.showDetails = async function(id) {

    try {

        const response = await fetch(API + "/file/" + id, {
            headers: { "Authorization": AUTH_HEADER }
        });

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

                row.innerHTML = `
                <td>${part.index}</td>
                <td>${part.name}</td>
                <td>${part.file_id}</td>
                <td>${part.message_id}</td>
                `;

                partTableBody.appendChild(row);

            });

        }

    } catch (error) {
        console.error(error);
    }

};

// =========================================================
// DELETE FILE
// =========================================================

window.deleteFile = async function(id) {

    const ok = confirm("Xóa file?");

    if (!ok) return;

    try {

        await fetch(API + "/file/" + id, {
            method: "DELETE",
            headers: { "Authorization": AUTH_HEADER }
        });

        addLog("Delete: " + id);

        loadFiles();

    } catch (error) {
        console.error(error);
    }

};

// =========================================================
// DOWNLOAD - StreamSaver, ghép part tuần tự, không ngốn RAM
// =========================================================

/**
 * Tải file:
 * 1. Lấy metadata (danh sách part + telegram file_id của từng part).
 * 2. Mở 1 WritableStream từ StreamSaver với tên file gốc.
 * 3. Lần lượt với từng part:
 *    - fetch(API + "/download/" + part.file_id) -> nhận ReadableStream
 *    - đọc từng chunk bằng reader.read() và writer.write(chunk) ngay,
 *      KHÔNG cộng dồn vào 1 buffer lớn.
 * 4. Đóng writer khi xong toàn bộ part.
 */
window.downloadFile = async function(id) {

    addLog("Bắt đầu download: " + id);

    let fileMeta;

    try {
        const response = await fetch(API + "/file/" + id, {
            headers: { "Authorization": AUTH_HEADER }
        });
        fileMeta = await response.json();
    } catch (error) {
        console.error(error);
        downloadStatus.textContent = "Lỗi: không lấy được metadata";
        return;
    }

    if (!fileMeta || !Array.isArray(fileMeta.parts) || fileMeta.parts.length === 0) {
        alert("File không có dữ liệu part để tải");
        return;
    }

    const parts = fileMeta.parts.slice().sort((a, b) => a.index - b.index);
    const totalParts = parts.length;

    // Mở stream ghi xuống đĩa qua StreamSaver
    const fileStream = streamSaver.createWriteStream(fileMeta.name || "download.bin", {
        size: fileMeta.size || undefined
    });

    const writer = fileStream.getWriter();

    downloadProgressBar.style.width = "0%";
    downloadStatus.textContent = `Đang tải part 1/${totalParts}...`;

    let totalDownloaded = 0;
    const totalSizeBytes = Number(fileMeta.size || 0);

    try {

        for (let i = 0; i < totalParts; i++) {

            const part = parts[i];

            downloadStatus.textContent = `Đang tải part ${i + 1}/${totalParts} (${part.name})`;

            const response = await fetch(API + "/download/" + part.file_id, {
                headers: { "Authorization": AUTH_HEADER }
            });

            if (!response.ok || !response.body) {
                throw new Error(`Không tải được part ${i + 1}`);
            }

            const reader = response.body.getReader();

            // Đọc tuần tự từng chunk và ghi ngay xuống đĩa
            while (true) {

                const { done, value } = await reader.read();

                if (done) break;

                await writer.write(value);

                totalDownloaded += value.length;

                if (totalSizeBytes > 0) {
                    const percent = Math.min(100, Math.round((totalDownloaded / totalSizeBytes) * 100));
                    downloadProgressBar.style.width = percent + "%";
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

        try {
            await writer.abort();
        } catch (e) {
            // ignore
        }
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

    if (bytes < 1024)
        return bytes + " B";

    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(2) + " KB";

    if (bytes < 1024 * 1024 * 1024)
        return (bytes / 1024 / 1024).toFixed(2) + " MB";

    return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";

}

function formatDate(timestamp) {

    if (!timestamp)
        return "-";

    return new Date(timestamp).toLocaleString();

}
