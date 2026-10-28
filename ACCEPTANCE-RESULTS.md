# Kết quả nghiệm thu bản local — 2026-10-27

> **Delta desktop:** yêu cầu mới về Zorin/Dynamic Island/PostgreSQL được ghi và kiểm thử riêng trong [DESKTOP-ZORIN.md](DESKTOP-ZORIN.md). Bộ kiểm thử hiện có thêm 4 unit tests repository (tổng 35), 5 tests PostgreSQL thật và 3 desktop E2E tests. Kết quả 41 AC dưới đây giữ phạm vi baseline web; không tự nâng các AC về Tower/Pill/tray/OS thành PASS từ floating Island mới.

> **Delta REST API:** [API.md](API.md) ghi contract mới, PostgreSQL config và kết quả **25 API tests PASS**, HTTP smoke/SQL readback/Swagger Chromium PASS. REST API độc lập dùng chung workspace table và writer lock với desktop; không diễn giải kết quả này thành xác nhận backend gốc.

> **Delta schema v2:** [DATABASE.md](DATABASE.md) ghi migration giữ nguyên dữ liệu thực, 34 API/migration/performance tests PASS trên schema chuẩn hóa và 3 desktop E2E PASS trên AppImage 1.1.0. Có EXPLAIN ANALYZE và fixture 10k tasks/100k sessions; không coi số đo fixture là SLA hay thay các tiêu chí UNKNOWN bằng pass giả định.

Nguồn tiêu chí: `ACCEPTANCE.md`. Báo cáo này là kết quả **triển khai mới**, không nâng mức tin cậy khảo sát tĩnh và không chứng nhận runtime của sản phẩm gốc.

## Kết quả thực chạy

| Kiểm tra | Kết quả |
|---|---|
| `npm run build` | PASS — TypeScript + Vite production build |
| `npm test` | PASS — 31 tests / 2 files (model, persistence) |
| `npm run test:e2e` | PASS — 13 Chromium E2E tests, 2 workers |
| Preview sau nghiệm thu | Đang nghe `0.0.0.0:4173`; `curl --head http://127.0.0.1:4173` trả HTTP 200 |
| npm install audit | 0 vulnerabilities ở dependency tree đã khóa |
| Desktop / mobile smoke | PASS tại 1440×1000 và 390×844, mobile không overflow toàn trang; board cuộn ngang riêng |
| Console / network smoke | Không có pageerror hoặc request ngoài origin preview trong luồng dashboard/reports/focus/appearance mẫu đã chạy |
| Reload persistence | PASS — task, notes, preference và running→paused timer recovery |
| Storage failure | PASS — quota error hiển thị; JSON không hợp lệ không bị ghi đè |

Môi trường: Linux, Node 22.23.4, npm 10.9.9, React 19, TypeScript 5.7, Vite 6, Vitest 5, Playwright Chromium. Phiên bản khóa chính xác ở `package-lock.json`.

## Quy ước

- **PASS-local**: điều kiện đã kiểm tra trong mô hình local, không tuyên bố backend/OS tương đương.
- **PARTIAL**: có phần kiểm chứng được; chưa chạy đủ kịch bản nguyên văn.
- **NOT RUN**: chưa triển khai/chưa kiểm kịch bản.
- **BLOCKED**: thiếu contract/authority backend hoặc OS; không đánh dấu pass theo giả định.

Tổng: **24 PASS-local, 3 PARTIAL, 9 NOT RUN, 5 BLOCKED**.

## Theo từng AC

| AC | Kết quả | Bằng chứng / giới hạn |
|---|---|---|
| AC-01 | PASS-local | Browser thấy bốn cột, Today có class nhấn mạnh; task archive riêng khỏi Done. |
| AC-02 | PASS-local | Unit từ chối whitespace; browser disable Create task với title trắng. |
| AC-03 | PARTIAL | Browser tạo/reload chỉ một task. Không có optimistic remote response trễ nên chưa chạy phần ack-race. |
| AC-04 | PASS-local | Unit + browser xác minh completedAt và reopen về Today, bỏ timestamp. |
| AC-05 | PASS-local | Unit cùng lượt có success/skipped/error, ID trùng chỉ xử lý một lần, empty selection no-op; browser bulk archive 2 tasks. Không có partial remote failure. |
| AC-06 | NOT RUN | Bản local không có avatar update/upload hoặc hậu kỳ async. |
| AC-07 | PASS-local | Browser archive/restore list; task array giữ nguyên. Quy tắc ẩn/hiện con được ghi NEW-05, không suy là hành vi gốc. |
| AC-08 | PASS-local | Browser blank rename giữ tên; Escape xóa draft và không đóng editor. |
| AC-09 | PASS-local | Browser toggle tiến độ và drag reorder; unit same-position/missing-target no-op. |
| AC-10 | PASS-local | Browser thay draft nhiều lần, đóng/blur rồi reload giữ notes cuối; task/subtask notes tách biệt. Debounce code 300 ms, flush khi unmount. |
| AC-11 | PASS-local | Unit + browser chuyển A→B, ghi segment và giữ sprint. |
| AC-12 | PASS-local | Unit launch running không interval thừa; browser pause elapsed đứng yên và resume. |
| AC-13 | PASS-local | Unit + browser preview cancel từ running và từ paused giữ đúng trạng thái. |
| AC-14 | PASS-local | Unit gửi stale cancel A sau launch B, B không đổi. Không mô phỏng race đa cửa sổ. |
| AC-15 | PASS-local | Unit chạy tới sprint thứ 2/2 chọn long break, không Done task. |
| AC-16 | PASS-local | Unit 0/âm/Infinity/NaN bị từ chối, round/min; browser zero short break không ghi đè 5 phút cũ. |
| AC-17 | PASS-local | Unit stop cả running/paused ghi segment; browser Back to Dashboard dừng và thêm sessions. |
| AC-18 | PASS-local | Unit gap >60s không cộng mất quan sát; browser reload khôi phục paused. Không kiểm crash/power loss. |
| AC-19 | PASS-local | Unit 999 ms không ghi, 1000 ms ghi. |
| AC-20 | NOT RUN | Full crossing/extend-break re-arm chưa triển khai; cue chuyển phase local không thay thế tiêu chí này. |
| AC-21 | PASS-local | Unit Monday 2026-10-26 → Monday 2026-11-02. |
| AC-22 | PASS-local | Unit 23:40 → 00:30 ngày tiếp theo. |
| AC-23 | NOT RUN | Chưa có scheduling conflict engine. |
| AC-24 | NOT RUN | Chưa có reminder editor/5-minute guard. |
| AC-25 | BLOCKED | Chưa có recurrence engine/scope edit; merge cần contract chưa có. |
| AC-26 | NOT RUN | Bell local rỗng; chưa có unread 100 hay async notification feed generation. |
| AC-27 | NOT RUN | Chưa có reminder polling window/delivery; OS kiểm riêng. |
| AC-28 | PARTIAL | Unit xác minh 7 ngày lịch; browser filter local đổi dataset đúng. Không có response async để thử trả ngược. |
| AC-29 | PASS-local | Unit hai Mondays (60 phút, zero) cho average 30 phút. |
| AC-30 | NOT RUN | Chưa có accuracy buckets; không tự đặt classification khi UNKNOWN. |
| AC-31 | PARTIAL | Browser end=start bị chặn; code có busy và đóng modal sau save. Chưa chạy double-submit/async write-race riêng. |
| AC-32 | PASS-local | Unit + browser xuất 121 sessions dù chỉ hiện 10 rows; quote/newline/formula-like và 1.5 phút đúng. Filter/export đồng bộ trên toàn mảng, không có request phân trang hay export pending để stale. Không chứng nhận remote paging/cancellation. |
| AC-33 | BLOCKED | Local snapshot/saving/error có kiểm thử; không có cloud response cũ để thử merge/edit race. |
| AC-34 | PASS-local | Browser edit rồi đóng ngay; storage và reload giữ preference, flush trước đóng. |
| AC-35 | PASS-local | Browser System + Cosmic Indigo, đổi OS dark→light và reload; System vẫn được lưu. |
| AC-36 | NOT RUN | Web chỉ Dashboard preview theo UI.md; không có Tower preview. |
| AC-37 | BLOCKED | Không có desktop main/tray/quit lifecycle. |
| AC-38 | BLOCKED | Không có Tower/display geometry/OS screen fallback. |
| AC-39 | NOT RUN | Shortcuts cố định, chưa có binding editor. Escape modal và subtask đã kiểm riêng nhưng không thay cho case này. |
| AC-40 | BLOCKED | Không đăng ký/restore global shortcuts với OS. |
| AC-41 | PASS-local | Browser Ctrl+Shift+A trong search input không mở add-task; Done shortcut trong break không mở completion preview. |

## Kiểm thử bổ sung đã pass

- Drag task lên card ở cột khác thực sự đổi stage; search tắt task dragging.
- Delete list archive child tasks, giữ history; restore child từ list deleted chọn list active đầu tiên và task hiện lại trên board.
- CSV filter theo list rỗng không hiển thị session giả.
- Modal Escape và focus; responsive dashboard không tràn viewport.
- Snapshot load validate, malformed snapshot được giữ nguyên; lỗi ghi được đưa lên UI.
- Không dùng subtask completion để tự complete parent.

## Ảnh kiểm tra từ bản chạy

- `test-results/dashboard-desktop.png`
- `test-results/dashboard-mobile.png`
- `test-results/reports-desktop.png`
- `test-results/focus-desktop.png`
- `test-results/appearance-desktop.png`

Đã xem ảnh dashboard desktop/mobile, reports và appearance. Đây là screenshot của thiết kế mới, không phải baseline so sánh pixel với sản phẩm gốc. Thư mục `test-results` được Playwright tạo lại mỗi lần chạy.

## Những gì chưa được tuyên bố pass

Exact pixel; backend aggregates/schema/authorization; recurrence occurrence generation/DST; reminder OS delivery; audio hardware; desktop/tray/global shortcuts; voice/AI; migration; license/auth/billing; concurrency nhiều tab/cửa sổ; full offline cold-start; crash durability và exactly-once. Các phần HELP-only không được chuyển thành acceptance bắt buộc.
