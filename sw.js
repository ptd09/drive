/**
 * TG-Drive Pro — Service Worker (sw.js)
 * Virtual Range HTTP Server cho multi-part media streaming
 * -------------------------------------------------------
 * Cơ chế:
 *   1. Intercept fetch /api/stream?id=<fileId>&auth=<token>
 *   2. Đọc metadata từ IndexedDB (store "stream_meta")
 *   3. Parse Range header từ <video>/<audio>
 *   4. Ánh xạ byte range → list of parts + per-part offsets
 *   5. Fetch từng part cần thiết từ API Worker (/download/:fileId)
 *      kèm Range header chính xác cho từng part
 *   6. Ghép stream, trả 206 Partial Content
 */

const SW_VERSION = "tgdrive-sw-v1";
const DB_NAME    = "tgdrive_db";
const DB_VERSION = 2;               // +1 để trigger onupgradeneeded thêm store mới
const META_STORE = "stream_meta";   // store mới, chứa { id, parts[], totalSize, mimeType }
const IDB_TIMEOUT = 5000;           // ms

// ─── Open IndexedDB ──────────────────────────────────────────────────────────
function openStreamDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            // Store cũ "upload_progress" — KHÔNG xóa
            if (!db.objectStoreNames.contains("upload_progress")) {
                db.createObjectStore("upload_progress", { keyPath: "sessionKey" });
            }
            // Store MỚI cho streaming metadata
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "id" });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);

        // Timeout fallback nếu IDB bị block
        setTimeout(() => reject(new Error("IDB open timeout")), IDB_TIMEOUT);
    });
}

function idbGet(db, store, key) {
    return new Promise((resolve, reject) => {
        const tx  = db.transaction(store, "readonly");
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror   = () => reject(req.error);
    });
}

// ─── Install / Activate ──────────────────────────────────────────────────────
self.addEventListener("install",  () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ─── Fetch intercept ─────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);

    // Chỉ xử lý /api/stream
    if (url.pathname !== "/api/stream") return;

    e.respondWith(handleStreamRequest(e.request, url));
});

// ─── Core stream handler ─────────────────────────────────────────────────────
async function handleStreamRequest(request, url) {
    const fileId = url.searchParams.get("id");
    const auth   = url.searchParams.get("auth") || "";

    if (!fileId) return badRequest("Missing id param");

    // 1. Lấy metadata từ IDB
    let db, meta;
    try {
        db   = await openStreamDB();
        meta = await idbGet(db, META_STORE, fileId);
    } catch (err) {
        return serverError("IDB error: " + err.message);
    }

    if (!meta) return notFound("No stream metadata for id: " + fileId);

    const { parts, totalSize, mimeType, apiBase } = meta;
    // parts: [{ index, file_id, size }]  (đã sorted by index)
    const sortedParts = [...parts].sort((a, b) => a.index - b.index);

    // Tính cumulative byte offset cho từng part
    // partRanges[i] = { start, end }  (trong không gian file ảo tổng hợp)
    const partRanges = [];
    let cursor = 0;
    for (const p of sortedParts) {
        partRanges.push({ start: cursor, end: cursor + p.size - 1, part: p });
        cursor += p.size;
    }

    // 2. Parse Range header
    const rangeHeader = request.headers.get("Range") || "";
    let reqStart = 0;
    let reqEnd   = totalSize - 1;

    if (rangeHeader) {
        const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
        if (!m) return rangeNotSatisfiable(totalSize);

        if (m[1] !== "") reqStart = Number(m[1]);
        if (m[2] !== "") reqEnd   = Math.min(Number(m[2]), totalSize - 1);
        else reqEnd = totalSize - 1;

        // suffix-range: bytes=-N  ↔  m[1]==""
        if (m[1] === "" && m[2] !== "") {
            reqStart = totalSize - Number(m[2]);
            reqEnd   = totalSize - 1;
        }

        if (reqStart > reqEnd || reqStart >= totalSize) {
            return rangeNotSatisfiable(totalSize);
        }
    }

    const responseLength = reqEnd - reqStart + 1;

    // 3. Xác định các parts liên quan đến [reqStart, reqEnd]
    const neededSegments = partRanges.filter(pr =>
        pr.end >= reqStart && pr.start <= reqEnd
    );

    if (neededSegments.length === 0) return rangeNotSatisfiable(totalSize);

    // 4. Tạo ReadableStream ghép từ các part fetches
    const readable = buildMergedStream(neededSegments, reqStart, reqEnd, auth, apiBase);

    const isRangeRequest = !!rangeHeader;
    const status  = isRangeRequest ? 206 : 200;
    const headers = {
        "Content-Type"   : mimeType || "video/mp4",
        "Content-Length" : String(responseLength),
        "Accept-Ranges"  : "bytes",
        "Cache-Control"  : "no-store",
    };
    if (isRangeRequest) {
        headers["Content-Range"] = `bytes ${reqStart}-${reqEnd}/${totalSize}`;
    }

    return new Response(readable, { status, headers });
}

// ─── Build merged ReadableStream ─────────────────────────────────────────────
/**
 * Với mỗi segment (part + virtual byte range), fetch phần cần thiết
 * từ /download/:file_id, đẩy vào ReadableStream theo thứ tự.
 */
function buildMergedStream(segments, reqStart, reqEnd, auth, apiBase) {
    const base = apiBase || self.location.origin;

    let segmentIdx = 0;
    let currentReader = null;
    // Bao nhiêu byte cần skip trong segment đầu tiên
    let skipInFirstSegment = 0;
    // Bao nhiêu byte còn phải ghi tổng
    let remaining = reqEnd - reqStart + 1;

    // Tính skipInFirstSegment: phần dư trong part đầu tiên trước reqStart
    if (segments.length > 0) {
        const first = segments[0];
        skipInFirstSegment = reqStart - first.start; // ≥0
    }

    async function startNextSegment() {
        if (segmentIdx >= segments.length) return null;

        const seg = segments[segmentIdx++];
        const partFileId = seg.part.file_id;

        // Tính Range header để gửi lên Worker
        // partLocalStart/End: offset trong riêng phần này
        const partLocalStart = segmentIdx === 1 // đã tăng rồi
            ? (reqStart - seg.start)
            : 0;
        // Phần cuối: reqEnd có thể nằm giữa segment cuối
        const isLast = segmentIdx >= segments.length;
        const partLocalEnd = isLast
            ? (reqEnd - seg.start)
            : (seg.part.size - 1);

        const fetchHeaders = {
            "Authorization": auth,
        };

        // Nếu chỉ cần một phần của part, gửi Range để tối ưu bandwidth
        if (partLocalStart > 0 || partLocalEnd < seg.part.size - 1) {
            fetchHeaders["Range"] = `bytes=${partLocalStart}-${partLocalEnd}`;
        }

        const res = await fetch(`${base}/download/${partFileId}`, {
            headers: fetchHeaders
        });

        if (!res.ok && res.status !== 206) {
            throw new Error(`Part fetch failed: ${res.status} for ${partFileId}`);
        }

        return res.body.getReader();
    }

    return new ReadableStream({
        async pull(controller) {
            try {
                while (remaining > 0) {
                    if (!currentReader) {
                        currentReader = await startNextSegment();
                        if (!currentReader) {
                            controller.close();
                            return;
                        }
                    }

                    const { done, value } = await currentReader.read();

                    if (done) {
                        currentReader = null;
                        continue; // chuyển sang segment tiếp
                    }

                    let chunk = value;

                    // Skip bytes ở đầu segment đầu tiên nếu cần
                    if (skipInFirstSegment > 0) {
                        if (chunk.byteLength <= skipInFirstSegment) {
                            skipInFirstSegment -= chunk.byteLength;
                            continue;
                        }
                        chunk = chunk.slice(skipInFirstSegment);
                        skipInFirstSegment = 0;
                    }

                    // Cắt để không vượt remaining
                    if (chunk.byteLength > remaining) {
                        chunk = chunk.slice(0, remaining);
                    }

                    controller.enqueue(chunk);
                    remaining -= chunk.byteLength;

                    if (remaining <= 0) {
                        controller.close();
                        return;
                    }
                }
                controller.close();
            } catch (err) {
                controller.error(err);
            }
        },
        cancel() {
            if (currentReader) {
                currentReader.cancel().catch(() => {});
            }
        }
    });
}

// ─── Response helpers ─────────────────────────────────────────────────────────
function badRequest(msg) {
    return new Response(JSON.stringify({ error: msg }), { status: 400,
        headers: { "Content-Type": "application/json" } });
}
function notFound(msg) {
    return new Response(JSON.stringify({ error: msg }), { status: 404,
        headers: { "Content-Type": "application/json" } });
}
function serverError(msg) {
    return new Response(JSON.stringify({ error: msg }), { status: 500,
        headers: { "Content-Type": "application/json" } });
}
function rangeNotSatisfiable(total) {
    return new Response(null, { status: 416,
        headers: { "Content-Range": `bytes */${total}` } });
}
