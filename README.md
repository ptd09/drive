# Telegram Drive - Serverless File Management System

Hệ thống lưu trữ và quản lý tệp tin Serverless kết hợp Telegram làm bộ nhớ lưu trữ file (Storage), Cloudflare KV làm cơ sở dữ liệu lưu metadata, Cloudflare Worker làm Backend API và giao diện trang web tĩnh (HTML/CSS/JS) triển khai trên GitHub Pages hoặc Vercel.

## 🛠 Công nghệ sử dụng

* **Frontend:** HTML5, CSS3, JavaScript (ES6+). Có thể mở rộng sử dụng thêm Tailwind CSS, React, Vue, Svelte hoặc bất kỳ framework web nào hỗ trợ build tĩnh trên GitHub / Vercel.
* **Backend API Gateway:** **Cloudflare Worker** (`drive-worker`) điều hướng request, kiểm tra mật khẩu xác thực và xử lý CORS.
* **Database (Metadata Index):** **Cloudflare KV** (Binding: `FILES` liên kết với KV namespace `telegram-drive`) dùng để lưu trữ thông tin chỉ mục, dữ liệu tệp tin.
* **Object Storage:** **Telegram Bot API** & **Telegram Channels** dùng làm kho chứa file thực tế không giới hạn dung lượng.

## 🏗 Kiến trúc hệ thống
[ Frontend: GitHub Pages / Vercel ]
│ (HTML / CSS / JS)
▼
[ Cloudflare Worker (drive-worker) ] ◄──► [ Cloudflare KV (FILES: telegram-drive) ]
│ (API Router & Auth)                   (Metadata Indexing)
▼
[ Telegram Bot API ] ──► [ Telegram Channels ]
(File Storage)

## ⚙️ Cấu hình Cloudflare Worker

### 1. KV Namespace Binding
Trong giao diện Cloudflare Worker `drive-worker`, truy cập **Settings -> Bindings** và cấu hình:
* **Variable name:** `FILES`
* **KV namespace:** `telegram-drive`

### 2. Environment Variables & Secrets
Cấu hình tại mục **Settings -> Variables**:

| Tên biến | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `ACCESS_PASSWORD` | Variable | Mật khẩu xác thực quyền truy cập từ giao diện Web. |
| `CHANNEL_DATA_ID` | Variable | ID của Telegram Channel lưu trữ file thực tế. |
| `CHANNEL_META_ID` | Variable | ID của Telegram Channel lưu nhật ký metadata. |
| `BOT_TOKEN` | Secret | Token mã hóa của Telegram Bot kết nối API. |

## 🚀 Danh sách API Endpoints

* **`POST /upload`**: Nhận file từ Frontend, đẩy lên Telegram Channel và lưu index vào Cloudflare KV (`FILES`).
* **`GET /files`**: Truy vấn danh sách tệp tin lưu trữ từ Cloudflare KV.
* **`OPTIONS /*`**: Phản hồi CORS Preflight request từ trình duyệt.

## 🔧 Quy trình vận hành & Triển khai

1. **Telegram:** Tạo Bot qua `@BotFather`, tạo 2 Channels (Data & Meta) rồi thêm Bot vào làm **Administrator**.
2. **Cloudflare:**
   * Tạo Worker đặt tên `drive-worker`.
   * Bind KV Namespace `telegram-drive` với tên biến `FILES`.
   * Điền đầy đủ 4 biến môi trường/secrets (`ACCESS_PASSWORD`, `BOT_TOKEN`, `CHANNEL_DATA_ID`, `CHANNEL_META_ID`).
3. **Frontend:**
   * Xây dựng giao diện bằng HTML, CSS, JavaScript gửi request kèm header `Authorization` chứa mật khẩu tới URL Worker (`https://drive-worker.<subdomain>.workers.dev`).
   * Đẩy mã nguồn lên **GitHub** (bật GitHub Pages) hoặc **Vercel** để lưu trữ trang web.