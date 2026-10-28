# PostgreSQL schema v2 — normalized storage, measured query paths

## Vì sao thay schema v1

Một JSONB chứa toàn workspace khiến edit nhỏ, timer tick và báo cáo phải chạm tới snapshot lớn. v2 tách entity thành rows, giữ JSON snapshot chỉ ở **backup migration**, explicit export và cache/UI desktop. Đây là thiết kế mới của Daylight, không phải schema backend Blitzit.

## Bảng và quan hệ

| Bảng | Primary key | Dữ liệu |
|---|---|---|
| `daylight_workspace_meta` | `id` | Revision và updated_at; **không có cột state** |
| `daylight_lists` | `(workspace_id, id)` | Name, color, position, archived/deleted |
| `daylight_tasks` | `(workspace_id, id)` | List FK, title, stage, notes TEXT, estimate, due, completed_at_ms, position, flags |
| `daylight_subtasks` | `(workspace_id, task_id, id)` | Parent FK, title, notes TEXT, due, done, position |
| `daylight_sessions` | `(workspace_id, id)` | Historical task/list IDs/title, start_ms/end_ms, kind, position |
| `daylight_preferences` | `workspace_id` | Typed preference columns |
| `daylight_timers` | `workspace_id` | Một row trạng thái timer; chỉ preview nhỏ dùng JSONB |
| `daylight_schema_migrations` | `version` | Schema version đã áp |

```text
workspace_meta ─┬─ lists ── tasks ── subtasks
               ├─ sessions (historical IDs/title)
               ├─ preferences (1:1)
               └─ timers (1:1; active task FK)
```

Composite FK ngăn task trỏ sang list của workspace khác. Xóa workspace cascade dữ liệu sở hữu. Task/list mặc định soft-delete; sessions không FK tới task/list để giữ lịch sử khi entity không còn. Session có CHECK `end_ms > start_ms`, kind work/break; enums/range preferences cũng có CHECK tại DB. Timestamp là BIGINT Unix milliseconds để giữ contract TypeScript.

DDL đầy đủ: [`database/002-normalized.sql`](database/002-normalized.sql).

## Index theo query thực tế

- Board: `(workspace_id, stage, position, id)` partial `WHERE NOT deleted AND NOT archived`.
- Tasks theo list: `(workspace_id, list_id, position, id)`.
- Completed task reports: `(workspace_id, completed_at_ms)` và `(workspace_id, list_id, completed_at_ms)`, partial khi timestamp không null.
- Subtasks: `(workspace_id, task_id, position, id)`.
- Sessions page: `(workspace_id, start_ms DESC, id DESC)`, INCLUDE duration/kind/list fields.
- Sessions filter list: `(workspace_id, list_id, start_ms DESC, id DESC)`.
- Sessions theo task: `(workspace_id, task_id, start_ms DESC)`.
- Search: GIN `pg_trgm` trên `lower(title || ' ' || notes)`, partial non-deleted. Pattern escape `%`, `_`, `\` để giữ literal substring semantics.

Không ép `enable_seqscan=off`. Planner được chọn Seq Scan khi rẻ hơn. Search ngắn/ít chọn lọc vẫn có thể scan nhiều rows; GIN có chi phí cập nhật và cần autovacuum/ANALYZE bình thường.

## Đọc và ghi

### Mutation

- API chỉ nạp task/list/session liên quan operation, cùng preferences/timer nhỏ; không tải toàn bộ lịch sử sessions để sửa title hoặc notes.
- Writer lock và revision precondition vẫn giữ contract cũ.
- Diff thành INSERT/UPDATE/DELETE **row/column đã đổi**. Update title không bind lại notes. Gộp row có cùng bộ cột thành batch tối đa 300 rows.
- JSONB trong `jsonb_populate_recordset` chỉ là payload truyền batch SQL, **không phải cột lưu toàn workspace**.
- Timer checkpoint ghi row timer và metadata revision; không update lại sessions.
- Bulk/reorder/archive children vẫn tỷ lệ với tập rows tác động; không tuyên bố O(1).

### Pagination / reports

- `GET /tasks` lọc, đếm và LIMIT/OFFSET trong PostgreSQL; chỉ lấy subtasks của các task trong trang.
- `GET /sessions` lọc theo timestamp range và LIMIT trong PostgreSQL; order `(start_ms DESC, id DESC)`.
- `nextCursor` dùng keyset seek, kiểm fingerprint filter; đổi filter phải bắt đầu cursor mới.
- **`totals=false`** bỏ COUNT/SUM toàn filter, trả `total: null`, `totalDurationMs: null`. Dùng cho infinite scroll:

```text
GET /api/v1/workspaces/api-demo/sessions?limit=50&totals=false
GET /api/v1/workspaces/api-demo/sessions?limit=50&totals=false&cursor=<nextCursor>
```

- `totals=true` mặc định giữ tương thích, nhưng exact totals vẫn có chi phí theo số rows khớp filter. Cursor không làm COUNT trở thành O(1).
- Reports dùng SUM/COUNT/GROUP BY tại SQL; ngày filter đổi thành timestamp bounds, không bọc `start_ms` bằng hàm trong WHERE nên dùng range index được. Node chỉ nhận aggregate buckets nhỏ.
- CSV dùng PostgreSQL cursor, fetch 500 rows/lượt, stream có backpressure; release connection khi hoàn tất hoặc abort, kể cả trước chunk đầu. Cùng một repeatable-read snapshot nên export không trộn các phiên bản dữ liệu. Slow export có idle transaction timeout 30 giây.

### Đường dẫn snapshot còn lại

`GET /workspaces/:id`, bootstrap desktop và `daylight_export_state(id)` **cố ý** dựng full snapshot, không dùng làm hot query. `daylight_workspaces` hiện là **VIEW** tương thích đọc/metadata, không phải bảng chứa JSONB. Client v1 cố UPDATE cột `state` của view sẽ bị từ chối; cần desktop **1.1.0+**.

Desktop renderer/cache vẫn giữ full state và còn giới hạn snapshot 20 MiB, full-state IPC/local outbox. Schema mới xử lý bottleneck PostgreSQL/API; không chứng nhận desktop render/bootstrap 100.000 sessions mượt. Client pagination/outbox incremental là công việc riêng nếu cần scale UI tới mức đó.

## Migration và dữ liệu thực

Migration chạy một transaction, có schema advisory lock và yêu cầu desktop writer đã thoát:

1. Giữ bảng cũ thành `daylight_workspaces_v1_backup`.
2. Tạo bảng typed, FK/check/index; backfill arrays theo ordinality để giữ thứ tự.
3. Dựng lại state từ normalized rows và so sánh JSONB với snapshot gốc.
4. Nếu có khác biệt, dữ liệu sai kiểu hoặc FK lỗi: rollback **toàn bộ migration**.
5. Ghi version 2. Chạy lại không rewrite rows.

Đã áp lên database đang dùng sau khi người dùng chọn **Đã Quit & save**:

| Workspace | Tasks | Sessions | Round-trip trước/sau |
|---|---:|---:|---|
| `default` | 12 | 39 | Khớp hoàn toàn |
| `api-demo` | 9 | 36 | Khớp hoàn toàn |

Backup dump trước migration: `/tmp/opencode/daylight-before-normalization-final.dump`. Snapshot v1 vẫn nằm trong bảng backup; app không cập nhật bảng đó. Không tự drop backup hoặc restore ngược lên dữ liệu mới. Nếu rollback cần restore dump vào database riêng để so sánh/chọn dữ liệu trước.

Các máy khác: Quit & save app v1, backup PostgreSQL, chạy API/desktop v2 để migrate, rồi chỉ dùng desktop 1.1.0 trở lên. Nếu gặp lỗi `pg_trgm` permission, DBA cần cài extension trong database trước; migration fail closed, không để schema nửa vời.

## Benchmark / verification

Lần đo: **2026-10-28T00:36:09Z**, PostgreSQL 17 Docker local, Node 22, database thử riêng, 10.000 tasks và 100.000 sessions. Có `VACUUM (ANALYZE)` trước đo; cache warm, không tắt seqscan. Các thời gian API dùng Fastify inject + PostgreSQL, không bao gồm TCP từ trình duyệt.

| Phép đo | Quan sát |
|---|---:|
| Keyset SQL lấy 50 sessions, EXPLAIN ANALYZE execution | **0,075 ms**, `Index Scan` trên `daylight_sessions_page_idx` |
| Search chọn lọc, SQL execution | **0,105 ms**, `Bitmap Index Scan` trên GIN search index |
| PATCH task, median 5 lần | **7,94 ms** |
| API trang 50 sessions, kèm exact totals cho 100k rows | **15,14 ms**, response **7.768 bytes** |
| API keyset page, `totals=false` | **1,92 ms** |
| Report bao trọn 100k sessions | **298,39 ms**, response **1.708 bytes** |
| Số history rows bị ghi lại khi edit task/checkpoint timer | **0 / 100.000** — kiểm `xmin` của mọi session |

Đây là kết quả của fixture/máy này, **không phải SLA** hoặc kết luận nhanh hơn v1 bao nhiêu lần (chưa đo baseline v1 cùng fixture). Exact aggregation vẫn O(rows trong range); chưa benchmark cold-cache, nhiều triệu rows, tải nhiều người dùng hoặc production hardware. Với báo cáo lớn thường xuyên, có thể cần daily rollup/materialized aggregate sau khi xác định timezone và invalidation; bản này chưa tự đặt thêm semantics đó.

Raw plans/metrics được sinh ở `benchmark-results/normalized-db.json` (ignored artifact). Kiểm thử:

```sh
# Chạy trên database thử riêng đã được tạo; không cần sửa .env chính.
DAYLIGHT_DB_NAME=daylight_v2_verify_6f28c4 npm run test:api
DAYLIGHT_DB_NAME=daylight_v2_verify_6f28c4 npm run test:postgres
```

- **34 API/migration/performance tests PASS**.
- **35 unit tests PASS**, **5 PostgreSQL desktop tests PASS**.
- **3 desktop E2E PASS** trên AppImage 1.1.0.
- Migration fixture kiểm giữ dữ liệu, rollback malformed input, composite FK và rerun no-op.
- Cursor tests có timestamps trùng và filter mismatch; CSV abort không giữ connection.
- API đang chạy lại: http://127.0.0.1:4310/docs/.

## Mã chính

- `database/migrate.ts`, `002-normalized.sql`: migration/versioning/round-trip.
- `database/store.ts`: typed mapping, scoped reads, incremental/batched writes dùng chung desktop/API.
- `api/database.ts`: transactions, metadata/revisions.
- `api/queries.ts`: SQL pages, keyset cursors, aggregates và streaming CSV.
- `api/normalization.integration.test.ts`, `api/performance.integration.test.ts`: correctness và evidence hiệu năng.
