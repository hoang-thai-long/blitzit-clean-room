# Daylight REST API và cấu hình PostgreSQL

Đây là **API mới do bản clean-room định nghĩa**, không phải endpoint/schema của Blitzit. Không có product login, license hoặc billing. Backend phục vụ dữ liệu local của Daylight bằng Fastify + TypeScript + PostgreSQL.

## Địa chỉ đang chạy

- API: **http://127.0.0.1:4310/api/v1**
- Swagger UI: **http://127.0.0.1:4310/docs/** — có nút Try it out.
- OpenAPI JSON: **http://127.0.0.1:4310/openapi.json**
- Liveness: **http://127.0.0.1:4310/health**
- PostgreSQL readiness: **http://127.0.0.1:4310/ready**
- Workspace mẫu: `api-demo`, tạo một lần bằng `npm run api:smoke`; không ghi đè workspace đã tồn tại.

Máy này đã có dịch vụ khác ở cổng 3001. `.env` hiện đặt `DAYLIGHT_API_PORT=4310`; default của code khi bỏ biến vẫn là 3001. Không thay đổi dịch vụ ở cổng 3001.

## Khởi động

### Docker Compose (đang dùng trong phiên này)

```sh
npm run db:setup
npm run api:up
npm run api:smoke
```

Lệnh tương đương khi không cần npm launcher:

```sh
docker compose --profile api up -d --build --wait
```

Nếu chưa có `.env`, dùng `.env.example` và đặt password riêng trước khi chạy Compose. Không ghi đè `.env` hiện tại. `db:setup` chỉ tạo khi file chưa tồn tại.

API chạy trong `daylight-api-1`, PostgreSQL trong `daylight-postgres-1`. API container kết nối host `postgres:5432` trong Docker network; host bên ngoài dùng `127.0.0.1:54329`. Cả hai published ports đều chỉ bind loopback.

```sh
docker compose --profile api ps
npm run api:logs
npm run api:down     # Chỉ dừng API, giữ PostgreSQL và volume
```

### Chạy Node trực tiếp

```sh
npm ci
npm run db:up
npm run api:build
npm run api:start
```

Hoặc `npm run api:dev` để chạy TypeScript qua tsx. Không chạy Node API và container API trên cùng cổng cùng lúc; `npm run api:down` trước nếu chuyển cách chạy.

Migration riêng: `npm run api:db:migrate`. Khi server khởi động cũng tự áp migration idempotent; lỗi database làm startup thất bại, không phục vụ như thể DB đã sẵn sàng.

## Cấu hình `.env`

| Biến | Default | Ý nghĩa |
|---|---|---|
| `DAYLIGHT_DB_HOST` | `127.0.0.1` | Host PG khi chạy Node trên máy |
| `DAYLIGHT_DB_PORT` | `54329` | Port host của Compose PG |
| `DAYLIGHT_DB_NAME` | `daylight` | Database |
| `DAYLIGHT_DB_USER` | `daylight` | Role PostgreSQL |
| `DAYLIGHT_DB_PASSWORD` | bắt buộc | Password, không log hoặc đưa vào browser |
| `DAYLIGHT_DATABASE_URL` | không có | Nếu đặt, ghi đè host/port/name/user/password rời |
| `DAYLIGHT_DB_SSL` | `false` | TLS xác minh certificate; không có tùy chọn bỏ verify |
| `DAYLIGHT_DB_CA_FILE` | không có | CA file cho PostgreSQL TLS riêng, đọc ở API Node |
| `DAYLIGHT_DB_POOL_MAX` | `8` | Số connection tối đa (1–50) |
| `DAYLIGHT_DB_CONNECT_TIMEOUT_MS` | `3000` | Connect/acquire deadline |
| `DAYLIGHT_DB_QUERY_TIMEOUT_MS` | `5000` | PostgreSQL statement timeout |
| `DAYLIGHT_DB_LOCK_TIMEOUT_MS` | `750` | Chờ workspace writer lock trước khi trả 423 |
| `DAYLIGHT_API_HOST` | `127.0.0.1` | Địa chỉ bind Node; trong container là `0.0.0.0` nhưng publish loopback |
| `DAYLIGHT_API_PORT` | `3001` | Phiên này override thành **4310** |
| `DAYLIGHT_API_CORS_ORIGINS` | localhost/127.0.0.1 cổng 5173, 4173 | Danh sách origin chính xác, phân tách dấu phẩy; không dùng wildcard |
| `DAYLIGHT_API_TIME_ZONE` | `Asia/Ho_Chi_Minh` | Ngày lịch/giờ của sessions filter và reports |
| `DAYLIGHT_API_LOG_LEVEL` | `info` | `info`, `warn`, `error`, `debug`, `silent` |

Swagger cùng origin localhost của API được phép tự gọi API. Browser origin ngoài allowlist nhận 403, kể cả write request; không chỉ thiếu CORS header. API là dịch vụ local một người dùng, chưa có authentication/authorization để công khai lên Internet.

Compose sử dụng database/name/user/password rời và tự đặt host `postgres`, port `5432`, không chuyển URL loopback trên máy host vào container. Nếu cần PG remote, chạy Node với URL hoặc sửa environment của service API theo hạ tầng của bạn. Thay `POSTGRES_DB`/user/password trong Compose **không** tự đổi role/database của volume đã khởi tạo; dữ liệu cũ không bị drop.

## Contract chung

Base path workspace:

```text
/api/v1/workspaces/:workspace
```

Workspace ID chỉ gồm chữ/số/`_`/`-`, dài 1–64. Entity IDs do server tạo. Request JSON có validation chặt; field lạ bị từ chối, không bỏ qua im lặng.

Response cho workspace-scoped operation:

```json
{
  "workspaceId": "api-demo",
  "revision": 3,
  "updatedAt": "2026-10-27T15:00:00.000Z",
  "data": {}
}
```

`data` là entity, array hoặc page/report tùy endpoint. Header `ETag: "3"` biểu diễn revision của **toàn workspace**, không phải riêng entity. `Cache-Control: no-store` cho dữ liệu workspace.

Write request hỗ trợ header tùy chọn `If-Match: "3"`. Revision cũ trả **412**, không thay đổi dữ liệu. Không gửi If-Match vẫn có transaction + writer lock chống mất các mutation độc lập, nhưng không phải bảo đảm chống cùng sửa một field từ state UI cũ.

Lỗi:

```json
{
  "error": {
    "code": "REVISION_MISMATCH",
    "message": "If-Match is stale; reload the workspace and retry"
  },
  "requestId": "req-7"
}
```

| Status | Nghĩa |
|---|---|
| 400 | Schema/query/header không hợp lệ |
| 403 | Browser Origin ngoài allowlist |
| 404 | Không có route/workspace/entity |
| 409 | Workspace ID đã tồn tại hoặc revision conflict |
| 412 | If-Match cũ |
| 413 | Request >1 MiB hoặc snapshot workspace >20 MiB |
| 422 | Business rule không hợp lệ, ví dụ title rỗng hoặc end≤start |
| 423 | Desktop/another writer giữ lock; có `Retry-After: 1` |
| 503 | PostgreSQL không khả dụng; chưa xác nhận save |

## Endpoints

Các đường dẫn trong bảng, trừ Workspaces/System, nối sau `/api/v1/workspaces/:workspace`.

### System / Workspaces

| Method | Path | Chức năng |
|---|---|---|
| GET | `/health` | Process sống |
| GET | `/ready` | Thử query PostgreSQL |
| GET | `/docs/` | Swagger UI |
| GET | `/openapi.json` | OpenAPI contract từ routes thực tế |
| GET | `/api/v1/workspaces?limit=50&offset=0` | Danh sách metadata workspace |
| POST | `/api/v1/workspaces` | `{ "id": "api-demo", "seed": true }`; seed mặc định false |
| GET | `/api/v1/workspaces/:workspace` | Full snapshot, gồm archived/deleted history |

Không có endpoint thay toàn bộ snapshot hoặc xóa toàn workspace. Khởi tạo trùng ID trả 409 và không reset dữ liệu.

### Lists

| Method | Path | Body/query |
|---|---|---|
| GET | `/lists` | `archived=true/false` (mặc định false) |
| POST | `/lists` | `{ name, color? }`, color `#RRGGBB` |
| GET | `/lists/:listId` | Read một list chưa deleted |
| PATCH | `/lists/:listId` | `{ name?, color? }` |
| POST | `/lists/reorder` | `{ ids: [...] }`, đầy đủ IDs của active lists |
| POST | `/lists/:listId/duplicate` | Copy tên + “Copy” + màu, không copy tasks |
| POST | `/lists/:listId/archive` | Giữ tasks con, ẩn khỏi active board |
| POST | `/lists/:listId/restore` | Hiện lại list/tasks |
| DELETE | `/lists/:listId` | Soft-delete list, archive tasks con, giữ sessions |

### Tasks / Notes

| Method | Path | Body/query |
|---|---|---|
| GET | `/tasks` | `listId`, `stage`, `q`, `archived`, `limit`, `offset` |
| POST | `/tasks` | `{ title, listId, stage?, notes?, estimate?, due? }` |
| GET | `/tasks/:taskId` | Task đầy đủ, gồm subtasks |
| PATCH | `/tasks/:taskId` | Bất kỳ field create nào, ít nhất một field |
| POST | `/tasks/reorder` | `{ stage, listId?, ids: [...] }`, đầy đủ active set thuộc scope |
| POST | `/tasks/bulk` | `{ ids: [...], operation: "done" | "archive" | "delete" }` |
| POST | `/tasks/:taskId/complete` | Chuyển Done + completedAt |
| POST | `/tasks/:taskId/reopen` | Về Today, bỏ completedAt |
| POST | `/tasks/:taskId/archive` | Archive riêng với Done |
| POST | `/tasks/:taskId/restore` | JSON `{}` hoặc `{ listId }`; chọn list active đích |
| DELETE | `/tasks/:taskId` | Soft-delete; giữ session history |
| GET | `/tasks/:taskId/notes` | `{ notes }` Markdown source |
| PUT | `/tasks/:taskId/notes` | `{ notes: "" }` để xóa nội dung |

Stage: `Backlog`, `This Week`, `Today`, `Done`. Title trim và không được trắng. `estimate: null` xóa estimate; `notes: ""` xóa notes; `due: ""` bỏ ngày. Date chấp nhận `YYYY-MM-DD` hoặc local wall-clock `YYYY-MM-DDTHH:mm`, kiểm ngày lịch thực; date-only vẫn có ngày. Không thêm recurrence/reminder rule engine.

Active tasks mặc định bỏ task deleted/archived và task thuộc list archived/deleted. `archived=true` lấy task archive riêng. Bulk trả từng ID với `success`, `skipped`, `error`; IDs trùng chỉ xử lý một lần, empty selection no-op. Search không đồng nghĩa scope reorder; phải gửi đầy đủ IDs của scope khi reorder.

### Subtasks

| Method | Path | Body |
|---|---|---|
| GET | `/tasks/:taskId/subtasks` | Ordered array |
| POST | `/tasks/:taskId/subtasks` | `{ title, notes?, due? }` |
| PATCH | `/tasks/:taskId/subtasks/:subtaskId` | `{ title?, notes?, due?, done? }` |
| PUT | `/tasks/:taskId/subtasks/order` | `{ ids: [...] }` toàn bộ subtasks, không trùng |
| DELETE | `/tasks/:taskId/subtasks/:subtaskId` | Xóa đúng một subtask |

Rename trắng giữ tên cũ. Toggle tất cả subtask không hoàn thành task cha. Notes/due của subtask độc lập với cha. Gửi `notes: ""` để xóa notes subtask.

### Preferences

GET/PATCH `/preferences`.

Fields: `mode` (dark/light/system), `brand` (năm brand của UI), `pomodoro`, `work` (1–120), `short` (1–60), `long` (1–60), `cycle` (1–12), `sound`, `showTime`, `fullTitle`. Durations API nhận phút nguyên; field boolean phải là JSON boolean, không tự đổi string. PATCH giữ field không được gửi.

### Sessions / Reports

| Method | Path | Body/query |
|---|---|---|
| GET | `/sessions` | `start`, `end` (date-only, inclusive), `listId`, `kind`, `limit`, `offset` |
| POST | `/sessions` | `{ taskId, start, end, kind? }`, timestamps **Unix milliseconds** |
| GET | `/sessions/:sessionId` | Session history |
| PATCH | `/sessions/:sessionId` | `{ start?, end? }`; start-only dời end để giữ duration |
| DELETE | `/sessions/:sessionId` | Xóa recorded session — thiết kế mới của API |
| GET | `/sessions/export.csv` | Cùng filter nhưng không pagination; xuất tất cả |
| GET | `/reports/overview` | `days=7/30/90` hoặc cặp `start`/`end`, thêm `listId` |

Sessions không phải API khởi động timer; live timer vẫn do desktop main process sở hữu. `kind` là work/break, mặc định work. End phải sau start.

Page shape:

```json
{
  "items": [],
  "total": 121,
  "limit": 10,
  "offset": 0,
  "nextOffset": 10,
  "totalDurationMs": 10890000,
  "timeZone": "Asia/Ho_Chi_Minh"
}
```

`totalDurationMs` có trên sessions page, tính toàn bộ filter, không chỉ trang hiện tại. Limit 1–100, offset ≥0; sessions sắp start giảm dần, ID làm tie-breaker. CSV có UTF-8 BOM, quote/newline escaping, tiền tố công thức được escape bằng dấu nháy đơn và giữ phút thập phân.

Reports trả `formula: "daylight-local-v1"`, `range`, `totals`, `weekdays`, `startsByHour`, `timeByList`, `unknowns`. Công thức giống thiết kế local đã ghi: chọn session theo ngày start; focus là tổng work duration, breaks riêng; active days đếm ngày có work; completed theo completedAt; average = focus/completed và `null` khi không có completed. Weekday average tính cả ngày zero; hourly chart đếm số work session bắt đầu. Custom range tối đa 366 ngày. Công thức aggregate gốc/accuracy/heatmap vẫn UNKNOWN.

## Ví dụ dùng ngay

```sh
# Kiểm tra database
curl http://127.0.0.1:4310/ready

# Khởi tạo workspace mẫu (lần đầu); chạy lại trả 409, không overwrite
curl -X POST http://127.0.0.1:4310/api/v1/workspaces \
  -H 'Content-Type: application/json' \
  -d '{"id":"api-demo","seed":true}'

# Thêm task vào list mẫu studio
curl -X POST http://127.0.0.1:4310/api/v1/workspaces/api-demo/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Thử REST API","listId":"studio","stage":"Today","estimate":25}'

# Xem kết quả và reports
curl 'http://127.0.0.1:4310/api/v1/workspaces/api-demo/tasks?stage=Today&limit=10'
curl 'http://127.0.0.1:4310/api/v1/workspaces/api-demo/reports/overview?days=7'

# Xuất toàn bộ sessions của filter
curl 'http://127.0.0.1:4310/api/v1/workspaces/api-demo/sessions/export.csv' \
  -o daylight-sessions.csv
```

JavaScript client bất kỳ:

```js
const base = 'http://127.0.0.1:4310/api/v1/workspaces/api-demo';
const response = await fetch(`${base}/preferences`);
const etag = response.headers.get('ETag');
const saved = await fetch(`${base}/preferences`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'If-Match': etag },
  body: JSON.stringify({ mode: 'system', brand: 'Cosmic Indigo' }),
});
if (saved.status === 412) { /* Đọc state mới trước khi thử lại edit. */ }
```

## Quan hệ với desktop và web

- API dùng đúng bảng `daylight_workspaces` của desktop; không tạo một database giả độc lập.
- PostgreSQL advisory lock cùng key `daylight:<workspace>`: desktop giữ session lock suốt lúc kết nối; API dùng transaction lock. Desktop đang mở workspace → GET API được phép, write API trả **423**. Quit desktop hoặc chọn Workspace ID khác để ghi qua API.
- Nhiều API request cùng workspace được serialize trong transaction; SELECT FOR UPDATE + revision check; rollback khi operation lỗi. Desktop offline có local edits rồi API thay DB → desktop reconnect báo conflict thay vì overwrite.
- Electron hiện vẫn dùng PostgreSQL client trong main process qua IPC; browser UI hiện vẫn là localStorage. Đợt này bổ sung REST backend, Swagger và cấu hình chạy, **chưa đổi transport UI thành HTTP**.
- Không có sync đa người dùng, product auth, HTTP idempotency keys hoặc cam kết exactly-once khi mất kết nối lúc response. Session/snapshot đều theo schema mới của Daylight.

## Mã và kiểm thử

- `api/config.ts`: đọc/validate env, TLS/pool/timeouts/CORS.
- `api/database.ts`: migration, PG pool, writer lock, transactions/revision.
- `api/app.ts`: REST routes, schemas/OpenAPI, error handling.
- `api/domain.ts`: quy tắc task/list/subtask/preferences/session.
- `api/reports.ts`: filter và công thức local với timezone tường minh.
- `database/001-workspaces.sql`: migration idempotent, không drop/reset data.
- `Dockerfile.api`, `compose.yaml`: image non-root + API/PostgreSQL health checks.
- `api/*.test.ts`: **25 tests PASS** với PostgreSQL thật, bao gồm concurrent writes, 423 khi desktop giữ lock, stale If-Match, rollback, CRUD, CSV 121 sessions, reports và CORS.

```sh
npm run test:api
npm run api:smoke
```

Integration tests dùng workspace IDs ngẫu nhiên và chỉ dọn đúng IDs đó. `api:smoke` kiểm TCP HTTP của service đang chạy và tạo/giữ `api-demo` để dùng thử, không xóa dữ liệu demo đã có. Unit tests cũ **35/35**, PostgreSQL desktop tests **5/5**, build React và API đều PASS sau bổ sung backend.

Kiểm tra runtime đã thực hiện: Docker API healthy; HTTP smoke PASS; SQL readback thấy `api-demo` revision 1 với 9 tasks và 36 sessions; Swagger render trong Chromium có 41 operations/27 paths và không có pageerror. Cổng 4310 được chọn vì cổng 3001 đã có dịch vụ khác; không dừng hoặc sửa dịch vụ đó.
