const PASSWORD = "140613";

const API = "https://drive-worker.phamdatt140613.workers.dev";

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

const detailId = document.querySelector(".detail-id");
const detailName = document.querySelector(".detail-name");
const detailSize = document.querySelector(".detail-size");
const detailParts = document.querySelector(".detail-parts");
const detailStatus = document.querySelector(".detail-status");

const logList = document.querySelector(".log-list");

init();

function init() {

    if (localStorage.getItem("drive_auth") === "1") {
        showDashboard();
    } else {
        showLogin();
    }

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

uploadBtn.addEventListener("click", uploadFile);

async function uploadFile() {

    const file = uploadInput.files[0];

    if (!file) {

        alert("Chọn file");

        return;

    }

    try {

        uploadProgressBar.style.width = "20%";
        uploadProgressText.textContent = "Đang upload...";
        managerUploadBar.style.width = "20%";
        uploadStatus.textContent = "Đang upload...";

        const form = new FormData();

        form.append("file", file);

        const response = await fetch(
            API + "/upload",
            {
                method: "POST",
                body: form
            }
        );

        const data = await response.json();

        uploadProgressBar.style.width = "100%";
        managerUploadBar.style.width = "100%";

        uploadProgressText.textContent = "100%";
        uploadStatus.textContent = "Hoàn tất";

        addLog("Upload: " + file.name);

        loadFiles();

    } catch (error) {

        console.error(error);

        uploadStatus.textContent = "Lỗi upload";

        addLog("Upload lỗi");

    }

}

async function loadFiles() {

    try {

        const response = await fetch(
            API + "/files"
        );

        const files = await response.json();

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
            <span class="badge badge-success">
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

window.showDetails = async function(id) {

    try {

        const response = await fetch(
            API + "/file/" + id
        );

        const file = await response.json();

        detailId.textContent =
        "ID: " + (file.id || "-");

        detailName.textContent =
        "Tên: " + (file.name || "-");

        detailSize.textContent =
        "Dung lượng: " +
        formatSize(file.size || 0);

        detailParts.textContent =
        "Part Count: " +
        (file.part_count || 1);

        detailStatus.textContent =
        "Trạng thái: " +
        (file.status || "-");

        partTableBody.innerHTML = "";

        if (Array.isArray(file.parts)) {

            file.parts.forEach(part => {

                const row =
                document.createElement("tr");

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

window.deleteFile = async function(id) {

    const ok = confirm(
        "Xóa file?"
    );

    if (!ok) return;

    try {

        await fetch(
            API + "/file/" + id,
            {
                method: "DELETE"
            }
        );

        addLog("Delete: " + id);

        loadFiles();

    } catch (error) {

        console.error(error);

    }

};

window.downloadFile = function(id) {

    addLog("Download: " + id);

    alert(
        "Chưa có API download\nID: " + id
    );

};

function addLog(text) {

    const li =
    document.createElement("li");

    li.className =
    "log-item";

    li.textContent =
    new Date().toLocaleTimeString() +
    " - " +
    text;

    logList.prepend(li);

}

function formatSize(bytes) {

    bytes = Number(bytes || 0);

    if (bytes < 1024)
        return bytes + " B";

    if (bytes < 1024 * 1024)
        return (
            bytes / 1024
        ).toFixed(2) + " KB";

    if (bytes < 1024 * 1024 * 1024)
        return (
            bytes / 1024 / 1024
        ).toFixed(2) + " MB";

    return (
        bytes /
        1024 /
        1024 /
        1024
    ).toFixed(2) + " GB";

}

function formatDate(timestamp) {

    if (!timestamp)
        return "-";

    return new Date(
        timestamp
    ).toLocaleString();

}
