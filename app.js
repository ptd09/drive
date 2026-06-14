const PASSWORD = "140613";

const API = "https://drive-worker.phamdatt140613.workers.dev";

const loginPage = document.getElementById("login-page");
const dashboard = document.getElementById("dashboard");

const loginForm = document.querySelector(".login-form");

const uploadInput = document.querySelector(".input-file");

const fileTable = document.querySelector(".file-list tbody");

const totalFiles = document.querySelectorAll(".stat-card p")[0];
const totalSize = document.querySelectorAll(".stat-card p")[1];

const uploadProgress = document.querySelector(
".upload-manager .progress-bar"
);

const uploadText = document.querySelector(
".upload-manager p:last-child"
);

const activityLog = document.querySelector(
".log-list"
);

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

loginForm.addEventListener(
"submit",
e => {

    e.preventDefault();

    const pass =
    document.querySelector(".input").value;

    if (pass === PASSWORD) {

        localStorage.setItem(
        "drive_auth",
        "1"
        );

        showDashboard();

    } else {

        alert("Sai khóa");

    }

}
);

async function loadFiles() {

    try {

        const res = await fetch(
        API + "/files"
        );

        const files =
        await res.json();

        renderFiles(files);

    } catch (err) {

        console.error(err);

    }

}

function renderFiles(files) {

    fileTable.innerHTML = "";

    let totalBytes = 0;

    files.reverse();

    files.forEach(file => {

        totalBytes += file.size;

        const tr =
        document.createElement("tr");

        tr.innerHTML = `

        <td>${file.id}</td>

        <td>${file.name}</td>

        <td>${formatSize(file.size)}</td>

        <td>1</td>

        <td>
        ${new Date(
        file.created_at
        ).toLocaleString()}
        </td>

        <td>
        <span class="badge badge-success">
        ${file.status}
        </span>
        </td>

        <td class="actions">

        <button
        class="btn btn-success"
        onclick="downloadFile(
        '${file.file_id}'
        )"
        >
        Download
        </button>

        <button
        class="btn btn-danger"
        onclick="deleteFile(
        '${file.id}'
        )"
        >
        Delete
        </button>

        </td>

        `;

        fileTable.appendChild(tr);

    });

    totalFiles.textContent =
    files.length;

    totalSize.textContent =
    formatSize(totalBytes);

}

async function uploadFile() {

    const file =
    uploadInput.files[0];

    if (!file) {

        alert("Chọn file");

        return;

    }

    const form =
    new FormData();

    form.append(
    "file",
    file
    );

    uploadProgress.style.width =
    "20%";

    uploadText.textContent =
    "Đang upload...";

    try {

        const res =
        await fetch(
        API + "/upload",
        {
            method: "POST",
            body: form
        }
        );

        const data =
        await res.json();

        console.log(data);

        uploadProgress.style.width =
        "100%";

        uploadText.textContent =
        "Upload hoàn tất";

        addLog(
        "Upload " +
        data.name
        );

        loadFiles();

    } catch (err) {

        console.error(err);

        uploadText.textContent =
        "Upload lỗi";

    }

}

async function deleteFile(id) {

    const ok =
    confirm(
    "Xóa file?"
    );

    if (!ok)
    return;

    try {

        await fetch(
        API +
        "/file/" +
        id,
        {
            method: "DELETE"
        }
        );

        addLog(
        "Delete " + id
        );

        loadFiles();

    } catch (err) {

        console.error(err);

    }

}

function downloadFile(fileId) {

    alert(
    "Download API chưa làm\n\n" +
    fileId
    );

}

function addLog(text) {

    const li =
    document.createElement("li");

    li.className =
    "log-item";

    li.textContent =
    new Date()
    .toLocaleTimeString()
    + " - " +
    text;

    activityLog.prepend(li);

}

function formatSize(bytes) {

    if (
    bytes < 1024
    ) {
        return bytes + " B";
    }

    if (
    bytes <
    1024 * 1024
    ) {
        return (
        bytes / 1024
        ).toFixed(2)
        + " KB";
    }

    if (
    bytes <
    1024 *
    1024 *
    1024
    ) {
        return (
        bytes /
        1024 /
        1024
        ).toFixed(2)
        + " MB";
    }

    return (
    bytes /
    1024 /
    1024 /
    1024
    ).toFixed(2)
    + " GB";

}

document
.querySelector(
".upload-section .btn-primary"
)
.addEventListener(
"click",
uploadFile
);

document
.querySelector(
".header .btn-danger"
)
.addEventListener(
"click",
() => {

    localStorage.removeItem(
    "drive_auth"
    );

    location.reload();

}
);
