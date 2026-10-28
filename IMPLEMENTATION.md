# Daylight — bản triển khai clean-room local-first

> **Bổ sung desktop theo yêu cầu mới:** xem [DESKTOP-ZORIN.md](DESKTOP-ZORIN.md) cho Electron, Dynamic Island, PostgreSQL, gói `.deb`/AppImage và kiểm thử. Các mục web/localStorage bên dưới mô tả baseline web; desktop dùng main-process timer và PostgreSQL + file outbox thay thế.

> **Bổ sung REST API:** xem [API.md](API.md) cho Fastify/TypeScript, endpoints CRUD, Swagger, PostgreSQL config và Docker service. API là thiết kế mới, dùng chung bảng workspace và cơ chế writer lock với desktop; không đổi transport của UI trong đợt này.

> **Schema chuẩn hóa v2 / bản desktop 1.1.0:** xem [DATABASE.md](DATABASE.md) cho entity tables/indexes, row-level incremental writes, SQL pagination/aggregates, keyset + `totals=false`, streaming CSV, migration giữ dữ liệu và benchmark. Không còn ghi JSONB toàn workspace lên PostgreSQL.

## Nguồn và phạm vi

Chỉ dùng `README.md`, `BEHAVIOR.md`, `UI.md`, `ACCEPTANCE.md` trong workspace này làm đặc tả. Bốn file gốc giữ nguyên. Không truy cập workspace `/home/longht/blitzit`, AppImage, mã trích xuất, hay tài liệu phân tích. Không dùng REA để khảo sát artifact. Không gọi API Blitzit và không triển khai license/auth/billing.

Đây là sản phẩm web độc lập, **không phải chứng nhận tương đương toàn bộ Blitzit**. Các phần UNKNOWN và HELP-only được ghi trong ứng dụng tại Settings → About & scope và trong tài liệu này.

## Chạy

Yêu cầu Node.js 22.12+ (đã chạy với 22.23.4) và npm.

```sh
npm ci
npm run dev
```

Build/preview:

```sh
npm run build
npm run preview -- --strictPort
```

Preview: **http://localhost:4173**. Server bind `0.0.0.0`; cùng máy có thể dùng `http://127.0.0.1:4173`. Khi dùng trình duyệt trên máy khác, cần IP máy chạy hoặc chuyển tiếp cổng 4173. Giữ nguyên origin để dùng lại cùng dữ liệu: `localhost` và `127.0.0.1` có storage riêng.

Kiểm thử:

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

Playwright tự khởi động preview nếu chưa có server ở cổng 4173. Khi sửa code, chạy build trước E2E vì E2E kiểm tra production bundle.

## Các chức năng đã có

- Dashboard/sidebar responsive; search title/notes; All lists và lọc theo list.
- Bốn cột Backlog / This Week / Today / Done, Today có nhấn mạnh, kéo chuyển cột/sắp thứ tự; tắt drag khi đang tìm kiếm.
- Tạo/sửa task; estimate có thể xóa; do-date và Later today/Tomorrow/Next week; Done/reopen có timestamp.
- Select/bulk Done/archive/delete, kết quả success/skipped/error riêng, xác nhận trước delete.
- List create/rename/color/reorder/duplicate/archive/restore/delete; task archive riêng, Done có nhóm archived mở/đóng.
- Subtasks add/rename/toggle/delete/reorder, progress, notes và due-date độc lập; hoàn thành subtasks không hoàn thành cha.
- Markdown editor/preview; debounce 300 ms và flush khi blur/unmount. Không xử lý HTML thô thành HTML thực thi; dùng chính sách URL mặc định của react-markdown. Markdown không phải renderer tương đương với sản phẩm gốc.
- Focus/free timer, Pomodoro short/long cycle, pause/resume, completion preview/cancel/confirm, switch task giữa sprint, manual break, stop/save khi về Dashboard.
- Recovery paused khi reload hoặc khoảng mất quan sát >60 giây; bỏ interval dưới 1 giây. Mini timer là thành phần **trong trang**, không phải cửa sổ desktop riêng.
- Preferences áp ngay, autosave ~450 ms và flush khi đóng; báo lỗi nếu storage không ghi được.
- Dark/Light/System và năm brand theme độc lập; System theo thay đổi OS. Preview chỉ Dashboard.
- Reports 7/30/90/custom days, filter list; focus totals, completed tasks, active days, average local; weekday average, session starts by hour, time by list + breaks, ẩn slice, session journal, sửa start/end, xuất tất cả sessions khớp filter thành CSV.
- Phím tắt trong trang cho Search/New list/Add task/Preferences/Dashboard/Pause/Done/Notes; guard nhập text, break và modal.

## Thiết kế mới — không phải hành vi gốc đã xác nhận

| Mã | Quyết định độc lập |
|---|---|
| NEW-01 | Tên Daylight, logo lá, copy Anh/Việt, bố cục/kích thước/màu nền/animation/responsive là thiết kế mới. Font hệ thống, icon lucide-react; không dùng asset gốc hoặc font tải ngoài. |
| NEW-02 | Vite + React + TypeScript; không backend, không cloud queue. Dùng snapshot JSON `version: 1` tại localStorage key `daylight.local.v1`, UUID cho entity. Schema này do bản local định nghĩa. |
| NEW-03 | Lần đầu mở tạo 3 lists, 9 tasks, subtasks/notes và 36 sessions mẫu trong 7 ngày. Mẫu minh họa có thể nằm sau thời điểm hiện tại trong cùng ngày; không diễn giải là lịch sử làm việc thật. Sidebar ghi “demo data”. |
| NEW-04 | Tạo task/list commit đồng bộ vào state rồi ghi localStorage. Không có optimistic remote draft/ack, avatar upload hoặc bước hậu kỳ remote. Storage lỗi giữ state trong bộ nhớ và hiện error banner. “Saved locally” chỉ có nghĩa lần `setItem` gần nhất trả về thành công. |
| NEW-05 | Archive list giữ nguyên task con nhưng ẩn chúng trên board; restore list cho hiện lại. Delete list là soft-delete; archive task con và giữ tên list/sessions để reports giải tên. Restore task thuộc list đã xóa chuyển sang list active đầu tiên và báo tên đích; nếu không có thì yêu cầu tạo list. |
| NEW-06 | Delete task là soft-delete và không xóa lịch sử session. Task Done/reopen giữ vị trí trong mảng local; reopen chuyển Today. Duplicate list chỉ tên + “Copy” + màu. |
| NEW-07 | Tác vụ bulk local phân biệt ID thiếu (error), task deleted/already-applied (skipped), và thành công. Không mô phỏng transaction backend hoặc partial acknowledgment từ server. |
| NEW-08 | Timer cập nhật mỗi ~1 giây, dùng thời gian hệ thống với delta không âm. Switching task ghi segment cũ; segment end = start + work/break time thực được tính. Recovery bỏ thời gian không được quan sát, khôi phục paused. Không chạy bù trong nền dài. |
| NEW-09 | Work hết sprint tự sang short/long break running; hết break về work/paused; không auto-Done. Số sprint trước long break 1–12. Manual break không tăng round. Cue âm thanh ngắn tại phase transition là thiết kế local, chưa kiểm audio hardware. |
| NEW-10 | Timer stop khi rời focus qua các mục điều hướng sidebar; search từ focus có thể đưa về board với mini timer tiếp tục chạy. Điểm dừng tường minh: Back to Dashboard/shortcut Dashboard/Stop timer. Archive list không tự sửa task con hoặc tự hoàn thành task active. |
| NEW-11 | Reports dùng ngày local của **start** để chọn session, không cắt session tại biên ngày. Focus = tổng `(end-start)` của work; active days = số ngày có work; completed = task có completedAt trong khoảng; average = tổng focus / completed, không có completed thì “—”. Đây **không** phải công thức aggregate server. |
| NEW-12 | Weekday average lấy tổng phút work của từng weekday / số ngày lịch weekday đó trong range, gồm ngày zero. Biểu đồ giờ đếm session work bắt đầu. Time by list tính work theo list và breaks riêng; ẩn slice đổi mẫu số. |
| NEW-13 | Journal load-more 10 rows/lần, totals/CSV từ toàn bộ mảng đã lọc. Lọc và tạo CSV đồng bộ, không có response cũ hoặc export async để đè filter mới. CSV UTF-8 BOM, quote/newline escaping, tiền tố công thức có thêm dấu nháy đơn, phút thập phân. |
| NEW-14 | Đổi start trong session editor giữ duration và dời end; submit bị chặn khi end≤start. Sau save local modal đóng ngay. |
| NEW-15 | Web shortcuts cố định, không có sửa binding/global OS registration. Modal có focus trap và Escape; Escape tại draft subtask chỉ hủy draft. |
| NEW-16 | Single-tab workspace; chưa merge nhiều tab, không có storage event synchronization. Storage JSON không hợp lệ được giữ nguyên, hiện error và dùng dữ liệu mẫu trong bộ nhớ, không tự ghi đè bản lỗi. Không tự migration. |
| NEW-17 | Không có network data khi chạy các luồng mẫu đã thử; app bundle/assets do preview phục vụ. Chưa làm service worker/PWA: cần web server để tải lại app; dữ liệu local-first không có nghĩa bảo đảm cold-start offline hoặc crash durability. |

## UNKNOWN / chưa triển khai

- Recurrence parent/template/occurrence và scope edit; không tự tạo rule engine từ suy đoán.
- Scheduling conflict/slot finder, reminder guard/delivery 90 giây, deadline riêng, calendar UI đầy đủ.
- Remote notifications feed/unread pagination/read reconciliation. Bell hiện feed rỗng local, không giả lập giao hàng OS.
- Full CR-013: interval reminders, overtime crossing, re-arm khi extend break. Chỉ có cue local ở chuyển phase.
- Formula aggregate server, accuracy bucket classification và activity heatmap.
- Cloud preference response/race, transactions/idempotency/exactly-once, multi-window hoặc multi-tab reconciliation.
- Desktop Tower/Pill, floating window thật, companion, tray/hide main, screen geometry, global shortcut registration/edit/rollback.
- Voice/AI, integrations, tags/memory/developer, account/license/billing/auth và migration: không triển khai.
- Exact pixel, full accessibility certification, browser matrix, crash/hardware/storage durability: chưa được chứng nhận.

## HELP-only

1. “Blitz Now chọn task Today đầu đủ điều kiện, bỏ task có giờ tương lai”: không biến thành rule bắt buộc; người dùng chọn task focus tường minh.
2. “Live title chỉ sửa trong Notes; EST/Time Taken chỉ sửa khi paused”: không khẳng định tương đương. Editor local cho sửa metadata khi mở; không có control chỉnh trực tiếp live elapsed.

## Bố cục mã

- `src/model.ts`: model local, task/bulk, timer state machine, dates, reports, CSV, seed.
- `src/storage.ts`: validate/load/recover/save snapshot.
- `src/App.tsx`: workspace, persistence coordinator, navigation, board, focus, list dialogs.
- `src/components.tsx`: modal, Markdown editor, task/subtask editor.
- `src/Settings.tsx`, `src/Reports.tsx`: preferences/appearance và reports local.
- `src/styles.css`: responsive light/dark/accent styles.
- `src/*.test.ts`, `tests/app.spec.ts`: unit và Chromium E2E.
- `ACCEPTANCE-RESULTS.md`: kết quả nghiệm thu thực chạy, không thay đổi trạng thái lịch sử trong tài liệu gốc.
