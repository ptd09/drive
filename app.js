const PASSWORD = "140613";
const API = "https://drive-worker.phamdatt140613.workers.dev";
const AUTH_HEADER = "140613";
const CHUNK_SIZE = 20 * 1024 * 1024;

let db = null;
let uploadQueue = null; 
let isPaused = false;
let currentFilesData = [];

const loginPage = document.querySelector("#login-page");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector(".login-form");
const passwordInput = document.querySelector(".password-input");
const fileTableBody = document.querySelector(".file-table-body");
const totalFiles = document.querySelector(".total-files");
const totalSize = document.querySelector(".total-size");
const searchInput = document.querySelector("#search-input");
const selectAllCheckbox = document.querySelector("#select-all");
const bulkDeleteBtn = document.querySelector("#bulk-delete-btn");
const clearAllStorageBtn = document.querySelector("#clear-all-storage-btn");
const selectCountSpan = document.querySelector("#select-count");
const uploadManagerPanel = document.querySelector("#upload-manager-panel");
const downloadManagerPanel = document.querySelector("#download-manager-panel");
const btnPauseUpload = document.querySelector("#btn-pause-upload");

const initDB = () => {
    return new Promise((resolve) => {
        const request = indexedDB.open("TG_DRIVE_DB", 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            db.createObjectStore("uploads", { keyPath: "fileId" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(); };
    });
};

if (localStorage.getItem("tg_drive_auth") === PASSWORD) {
    loginPage.style.display = "none";
    dashboard.style.display = "block";
    initDB().then(() => loadFiles());
}

loginForm.onsubmit = (e) => {
    e.preventDefault();
    if (passwordInput.value === PASSWORD) {
        localStorage.setItem("tg_drive_auth", PASSWORD);
        loginPage.style.display = "none";
        dashboard.style.display = "block";
        initDB().then(() => loadFiles());
    } else { alert("Sai mật mã!"); }
};

document.querySelector(".logout-btn").onclick = () => {
    localStorage.removeItem("tg_drive_auth");
    window.location.reload();
};

async function loadFiles() {
    try {
        const res = await fetch(`${API}/files`, { headers: { "Authorization": AUTH_HEADER } });
        const files = await res.json();
        currentFilesData = files;
        renderFiles(files);
    } catch (e) { addLog("Không tải được danh sách file"); }
}

function renderFiles(files) {
    fileTableBody.innerHTML = "";
    let totalBytes = 0;
    totalFiles.textContent = files.length;

    files.forEach(file => {
        totalBytes += file.size;
        const row = document.createElement("tr");
        row.setAttribute("data-id", file.id);
        row.innerHTML = `
            <td><input type="checkbox" class="file-select" value="${file.id}" onchange="handleSelectChange()"></td>
            <td><span class="file-name-cell" title="${file.name}">${file.name}</span></td>
            <td>${formatSize(file.size)}</td>
            <td>${new Date(file.created_at).toLocaleString("vi-VN")}</td>
            <td class="action-cell">
                <button class="btn btn-success" style="padding:4px 8px;font-size:11px;" onclick="previewFile('${file.id}')">👁️</button>
                <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="downloadFile('${file.id}')">⬇️</button>
                <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="deleteFile('${file.id}')">🗑️</button>
            </td>
        `;
        fileTableBody.appendChild(row);
    });
    totalSize.textContent = formatSize(totalBytes);
}

searchInput.oninput = () => {
    const term = searchInput.value.toLowerCase();
    const filtered = currentFilesData.filter(f => f.name.toLowerCase().includes(term));
    renderFiles(filtered);
};

selectAllCheckbox.onchange = () => {
    document.querySelectorAll(".file-select").forEach(cb => cb.checked = selectAllCheckbox.checked);
    handleSelectChange();
};

window.handleSelectChange = () => {
    const checked = document.querySelectorAll(".file-select:checked");
    if (checked.length > 0) {
        bulkDeleteBtn.style.display = "inline-flex";
        selectCountSpan.textContent = checked.length;
    } else {
        bulkDeleteBtn.style.display = "none";
    }
};

// XỬ LÝ XÓA CÁC MỤC ĐÃ CHỌN (Gửi chuỗi lệnh tuần tự lên API Worker)
bulkDeleteBtn.onclick = async () => {
    const checked = document.querySelectorAll(".file-select:checked");
    if (!confirm(`Xóa đồng loạt ${checked.length} mục đã chọn?`)) return;
    
    addLog(`Bắt đầu xóa đồng loạt ${checked.length} file...`);
    for (const cb of checked) {
        await fetch(`${API}/file/${cb.value}`, { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
    }
    selectAllCheckbox.checked = false;
    bulkDeleteBtn.style.display = "none";
    loadFiles();
};

// XỬ LÝ XÓA SẠCH TOÀN BỘ KHO DỮ LIỆU (Gửi 1 request duy nhất đến đầu /files)
clearAllStorageBtn.onclick = async () => {
    if (!confirm("CẢNH BÁO NGUY HIỂM: Bạn có chắc chắn muốn xóa SẠCH TOÀN BỘ file trong kho lưu trữ và tin nhắn Telegram? Thao tác này không thể hoàn tác!")) return;
    
    addLog("Đang gửi lệnh xóa toàn bộ kho dữ liệu lên Worker...");
    clearAllStorageBtn.disabled = true;
    clearAllStorageBtn.textContent = "Đang dọn dẹp...";

    try {
        const res = await fetch(`${API}/files`, {
            method: "DELETE",
            headers: { "Authorization": AUTH_HEADER }
        });
        if (res.ok) {
            addLog("Đã xóa sạch toàn bộ dữ liệu trên hệ thống thành công.");
            alert("Đã xóa sạch toàn bộ kho dữ liệu!");
        } else {
            addLog("Lỗi hệ thống khi yêu cầu xóa sạch.");
        }
    } catch (e) {
        addLog("Không thể kết nối đến máy chủ Worker để xóa.");
    } finally {
        clearAllStorageBtn.disabled = false;
        clearAllStorageBtn.textContent = "Xóa Sạch Kho";
        loadFiles();
    }
};

// CÁC LOGIC UPLOAD / DOWNLOAD / PREVIEW GIỮ NGUYÊN HIỆU NĂNG TỐT NHẤT
document.querySelector("#input-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fileId = "tg_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    const totalParts = Math.ceil(file.size / CHUNK_SIZE);
    const uploadState = { fileId, name: file.name, size: file.size, totalParts, completedParts: [] };
    const tx = db.transaction("uploads", "readwrite");
    tx.objectStore("uploads").put(uploadState);
    startUploadFlow(file, uploadState);
};

async function startUploadFlow(file, state) {
    uploadQueue = { file, state };
    isPaused = false;
    uploadManagerPanel.style.display = "block";
    btnPauseUpload.textContent = "Tạm dừng";
    document.querySelector(".uploading-file-name").textContent = state.name;

    for (let i = 0; i < state.totalParts; i++) {
        if (isPaused) return;
        if (state.completedParts.includes(i)) continue;

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append("file", chunk, `${state.name}.part${String(i+1).padStart(3, '0')}`);
        formData.append("original_name", state.name);
        formData.append("original_size", state.size);
        formData.append("part_index", i + 1);
        formData.append("part_count", state.totalParts);
        formData.append("file_id", state.fileId);

        let success = false; let retries = 3;
        while (!success && retries > 0 && !isPaused) {
            try {
                const res = await fetch(`${API}/upload`, { method: "POST", headers: { "Authorization": AUTH_HEADER }, body: formData });
                if (res.ok) {
                    success = true;
                    state.completedParts.push(i);
                    const tx = db.transaction("uploads", "readwrite");
                    tx.objectStore("uploads").put(state);
                    const totalUploadedBytes = state.completedParts.length * CHUNK_SIZE > state.size ? state.size : state.completedParts.length * CHUNK_SIZE;
                    const percent = Math.round((totalUploadedBytes / state.size) * 100);
                    document.querySelector(".manager-upload-progress-bar").style.width = percent + "%";
                    document.querySelector(".upload-status").textContent = percent + "%";
                }
            } catch (err) {
                retries--;
                if (retries === 0) { isPaused = true; btnPauseUpload.textContent = "Tiếp tục"; return; }
            }
        }
    }
    if (!isPaused) {
        const tx = db.transaction("uploads", "readwrite");
        tx.objectStore("uploads").delete(state.fileId);
        uploadManagerPanel.style.display = "none";
        addLog(`Hoàn tất tải lên: ${state.name}`);
        loadFiles();
    }
}

btnPauseUpload.onclick = () => {
    if (!isPaused) { isPaused = true; btnPauseUpload.textContent = "Tiếp tục"; }
    else { isPaused = false; btnPauseUpload.textContent = "Tạm dừng"; startUploadFlow(uploadQueue.file, uploadQueue.state); }
};

window.downloadFile = async function(id) {
    try {
        downloadManagerPanel.style.display = "block";
        const res = await fetch(`${API}/file/${id}`, { headers: { "Authorization": AUTH_HEADER } });
        const fileMeta = await res.json();
        document.querySelector(".downloading-file-name").textContent = fileMeta.name;
        fileMeta.parts.sort((a, b) => a.index - b.index);

        const fileStream = streamSaver.createWriteStream(fileMeta.name, { size: fileMeta.size });
        const writer = fileStream.getWriter();

        for (let i = 0; i < fileMeta.parts.length; i++) {
            const part = fileMeta.parts[i];
            const response = await fetch(`${API}/download/${part.file_id}`);
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
            }
            const currentPercent = Math.round(((i + 1) / fileMeta.parts.length) * 100);
            document.querySelector(".download-progress-bar").style.width = currentPercent + "%";
            document.querySelector(".download-status").textContent = currentPercent + "%";
        }
        await writer.close(); downloadManagerPanel.style.display = "none";
    } catch (e) { downloadManagerPanel.style.display = "none"; }
};

window.previewFile = async function(id) {
    const body = document.querySelector("#preview-body");
    body.innerHTML = "<div style='color:white;'>Đang tải luồng xem trước...</div>";
    document.querySelector("#preview-modal").style.display = "flex";
    try {
        const res = await fetch(`${API}/file/${id}`, { headers: { "Authorization": AUTH_HEADER } });
        const fileMeta = await res.json();
        if (fileMeta.part_count > 1) {
            body.innerHTML = "<div style='color:#ef4444;'>File lớn hơn 20MB, hãy dùng nút Download (⬇️).</div>"; return;
        }
        const mediaUrl = `${API}/download/${fileMeta.parts[0].file_id}`;
        const ext = fileMeta.name.split('.').pop().toLowerCase();
        const response = await fetch(mediaUrl); const blob = await response.blob(); const objectURL = URL.createObjectURL(blob);

        if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) body.innerHTML = `<img src="${objectURL}">`;
        else if (["mp4", "webm"].includes(ext)) body.innerHTML = `<video src="${objectURL}" controls autoplay></video>`;
        else if (["mp3", "wav", "ogg"].includes(ext)) body.innerHTML = `<audio src="${objectURL}" controls autoplay></audio>`;
        else if (ext === "pdf") body.innerHTML = `<iframe src="${objectURL}"></iframe>`;
        else body.innerHTML = "<div style='color:white;'>Định dạng chưa hỗ trợ xem trực tiếp.</div>";
    } catch (e) { body.innerHTML = "<div style='color:#ef4444;'>Lỗi tải xem trước.</div>"; }
};

window.closePreview = () => { document.querySelector("#preview-modal").style.display = "none"; };

window.deleteFile = async function(id) {
    if (!confirm("Xác nhận xóa file này?")) return;
    try {
        await fetch(`${API}/file/${id}`, { method: "DELETE", headers: { "Authorization": AUTH_HEADER } });
        addLog("Đã xóa file ID: " + id);
        loadFiles();
    } catch (e) { alert("Lỗi khi xóa file!"); }
};

let sortDirection = false;
window.sortTable = (columnIndex) => {
    sortDirection = !sortDirection; const rows = Array.from(fileTableBody.querySelectorAll("tr"));
    rows.sort((rowA, rowB) => {
        let cellA = rowA.querySelectorAll("td")[columnIndex].textContent.trim();
        let cellB = rowB.querySelectorAll("td")[columnIndex].textContent.trim();
        return sortDirection ? cellA.localeCompare(cellB) : cellB.localeCompare(cellA);
    });
    fileTableBody.innerHTML = ""; rows.forEach(row => fileTableBody.appendChild(row));
};

function addLog(text) {
    const logList = document.querySelector(".log-list");
    const li = document.createElement("li"); li.className = "log-item";
    li.textContent = `[${new Date().toLocaleTimeString()}] - ${text}`; logList.prepend(li);
}

function formatSize(bytes) {
    bytes = Number(bytes || 0); if (bytes === 0) return "0 B";
    const k = 1024; const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
