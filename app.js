const PASSWORD = "140613";
const API = "https://drive-worker.phamdatt140613.workers.dev";

// DOM Elements (Giữ nguyên của bạn)
const loginPage = document.querySelector("#login-page");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector(".login-form");
const passwordInput = document.querySelector(".password-input");
const uploadBtn = document.querySelector(".upload-btn");
const uploadInput = document.querySelector(".input-file");
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
const downloadProgressBar = document.querySelector(".download-progress-bar");
const downloadStatus = document.querySelector(".download-status");
const currentPartText = document.querySelector(".current-part");
const detailId = document.querySelector(".detail-id");
const detailName = document.querySelector(".detail-name");
const detailSize = document.querySelector(".detail-size");
const detailParts = document.querySelector(".detail-parts");
const detailStatus = document.querySelector(".detail-status");
const logList = document.querySelector(".log-list");

// Upload Controls
let isPaused = false;
let activeUploadTask = null;
const btnPause = document.getElementById("btn-pause");
const btnResume = document.getElementById("btn-resume");
const uploadControls = document.getElementById("upload-controls");

// --- QUẢN LÝ INDEXED DB CHO RESUME UPLOAD ---
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open("TelegramDrive", 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "id" });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}
async function saveProgress(id, data) {
    const db = await openDB();
    return new Promise(res => { const tx = db.transaction("progress", "readwrite"); tx.objectStore("progress").put({ id, ...data }); tx.oncomplete = () => res(); });
}
async function getProgress(id) {
    const db = await openDB();
    return new Promise(res => { const tx = db.transaction("progress", "readonly"); const req = tx.objectStore("progress").get(id); req.onsuccess = () => res(req.result); });
}
async function deleteProgress(id) {
    const db = await openDB();
    return new Promise(res => { const tx = db.transaction("progress", "readwrite"); tx.objectStore("progress").delete(id); tx.oncomplete = () => res(); });
}

init();

function init() {
    if (localStorage.getItem("drive_auth") === PASSWORD) showDashboard();
    else showLogin();
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
        localStorage.setItem("drive_auth", pass);
        showDashboard();
    } else alert("Sai khóa truy cập!");
});

logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("drive_auth");
    location.reload();
});

// --- LOGIC CHIA PART & UPLOAD ---
uploadBtn.addEventListener("click", uploadFile);

btnPause.onclick = () => { isPaused = true; addLog("Đã tạm dừng Upload"); };
btnResume.onclick = () => { isPaused = false; if (activeUploadTask) activeUploadTask(); addLog("Tiếp tục Upload"); };

async function generateFileId(file) {
    return "tg_" + btoa(encodeURIComponent(file.name)).substring(0, 10) + "_" + file.size;
}

async function uploadFile() {
    const file = uploadInput.files[0];
    if (!file) return alert("Vui lòng chọn file!");

    const fileId = await generateFileId(file);
    const partSizeMB = parseInt(document.getElementById("part-size").value) || 40;
    const PART_SIZE = partSizeMB * 1024 * 1024;
    const partCount = Math.ceil(file.size / PART_SIZE);

    let progressData = await getProgress(fileId);
    let startPartIndex = 1;

    if (progressData) {
        startPartIndex = progressData.current_part;
        addLog(`Phát hiện tiến trình cũ: Khôi phục từ part ${startPartIndex}`);
    } else {
        progressData = { name: file.name, current_part: 1, part_count: partCount };
        await saveProgress(fileId, progressData);
        addLog(`Bắt đầu chia file: ${partCount} parts (${partSizeMB}MB/part)`);
    }

    uploadControls.style.display = "flex";
    isPaused = false;

    activeUploadTask = async function() {
        for (let i = startPartIndex; i <= partCount; i++) {
            if (isPaused) {
                progressData.current_part = i;
                await saveProgress(fileId, progressData);
                return;
            }

            const startByte = (i - 1) * PART_SIZE;
            const endByte = Math.min(i * PART_SIZE, file.size);
            const chunk = file.slice(startByte, endByte);

            const extIdx = file.name.lastIndexOf(".");
            const baseName = extIdx !== -1 ? file.name.substring(0, extIdx) : file.name;
            const ext = extIdx !== -1 ? file.name.substring(extIdx) : "";
            const partStr = String(i).padStart(3, '0');
            const partName = `${baseName}.part${partStr}${ext}`;

            currentPartText.textContent = `Part hiện tại: ${i} / ${partCount} (${partName})`;
            uploadStatus.textContent = "Đang tải lên...";

            try {
                const meta = { id: fileId, name: file.name, size: file.size, part_index: i, part_count: partCount, part_name: partName };
                
                const response = await fetch(API + "/upload", {
                    method: "POST",
                    headers: {
                        "Authorization": PASSWORD,
                        "X-File-Meta": JSON.stringify(meta)
                    },
                    body: chunk
                });

                if (!response.ok) throw new Error("Upload Worker Failed");

                // Tính % cho UI
                const percent = Math.round((i / partCount) * 100);
                uploadProgressBar.style.width = percent + "%";
                managerUploadBar.style.width = percent + "%";
                uploadProgressText.textContent = percent + "%";
                uploadStatus.textContent = percent + "%";

                await saveProgress(fileId, { ...progressData, current_part: i + 1 });

            } catch (error) {
                console.error(error);
                uploadStatus.textContent = "Lỗi mạng, tự động thử lại sau 3s...";
                addLog(`Lỗi tại part ${i}, thử lại sau 3s`);
                i--; // Lùi lại 1 index để thử lại
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        // Hoàn thành
        uploadStatus.textContent = "Hoàn tất 100%";
        currentPartText.textContent = "Không có tiến trình nào";
        uploadControls.style.display = "none";
        addLog("Upload thành công: " + file.name);
        await deleteProgress(fileId);
        loadFiles();
    };

    activeUploadTask();
}

// --- TẢI DANH SÁCH FILE ---
async function loadFiles() {
    try {
        const response = await fetch(API + "/files", { headers: { "Authorization": PASSWORD } });
        if(!response.ok) return;
        const files = await response.json();
        renderFiles(files);
    } catch (error) {
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
        <td><span class="badge badge-success">${file.status || "uploaded"}</span></td>
        <td class="actions">
            <button class="btn btn-secondary" onclick="showDetails('${file.id}')">Chi Tiết</button>
            <button class="btn btn-success" onclick="downloadFile('${file.id}')">Tải Về</button>
            <button class="btn btn-danger" onclick="deleteFile('${file.id}')">Xóa</button>
        </td>`;
        fileTableBody.appendChild(tr);
    });

    totalFiles.textContent = files.length;
    totalSize.textContent = formatSize(totalBytes);
    usedSize.textContent = formatSize(totalBytes);
}

// --- XEM CHI TIẾT FILE ---
window.showDetails = async function(id) {
    try {
        const response = await fetch(API + "/file/" + id, { headers: { "Authorization": PASSWORD } });
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
        window.scrollTo({ top: document.querySelector('.details').offsetTop, behavior: 'smooth' });
    } catch (error) { console.error(error); }
};

// --- XÓA FILE ---
window.deleteFile = async function(id) {
    if (!confirm("Bạn có chắc chắn muốn xóa vĩnh viễn file này?")) return;
    try {
        await fetch(API + "/file/" + id, { method: "DELETE", headers: { "Authorization": PASSWORD } });
        addLog("Đã xóa file: " + id);
        document.querySelector('.details-card').innerHTML = '<p>Đã xóa dữ liệu</p>';
        loadFiles();
    } catch (error) { console.error(error); }
};

// --- LOGIC STREAM DOWNLOAD ---
window.downloadFile = async function(id) {
    addLog("Đang kết nối để tải file: " + id);
    try {
        const res = await fetch(API + "/file/" + id, { headers: { "Authorization": PASSWORD } });
        const fileMeta = await res.json();
        
        const fileStream = window.streamSaver.createWriteStream(fileMeta.name, { size: fileMeta.size });
        const writer = fileStream.getWriter();
        const partCount = fileMeta.parts.length;

        for (let i = 0; i < partCount; i++) {
            const part = fileMeta.parts[i];
            downloadStatus.textContent = `Đang tải: ${part.name} (${i+1}/${partCount})`;
            
            const partRes = await fetch(API + "/download/" + part.file_id);
            if (!partRes.ok) throw new Error("Lỗi tải part " + part.name);
            
            const reader = partRes.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                await writer.write(value);
            }

            const percent = Math.round(((i + 1) / partCount) * 100);
            downloadProgressBar.style.width = percent + "%";
            downloadStatus.textContent = `Hoàn thành: ${percent}%`;
        }
        await writer.close();
        downloadStatus.textContent = "Tải về hoàn tất!";
        addLog("Đã tải xong: " + fileMeta.name);
    } catch (err) {
        addLog("Lỗi Download: " + err.message);
        downloadStatus.textContent = "Lỗi tải về";
    }
};

// --- UTILS ---
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
