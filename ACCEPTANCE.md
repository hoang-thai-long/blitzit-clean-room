# Tiêu chí nghiệm thu dự kiến

**Trạng thái toàn bộ: NOT RUN.** Đây là test cases, không phải kết quả đã pass. Dùng dữ liệu và dịch vụ giả lập/local trong môi trường kiểm thử; không tác động tài khoản thật. Khi cần authority backend/OS chưa có, kết quả là BLOCKED/UNKNOWN, không phải pass theo giả định.

| AC | Quy tắc | Given / When | Then kỳ vọng |
|---|---|---|---|
| AC-01 | CR-001 | Board có task của bốn nhóm | Hiện đúng bốn cột, Today nổi bật; archive không bị coi là Done |
| AC-02 | CR-002 | Nhập title chỉ có khoảng trắng rồi submit | Không tạo task |
| AC-03 | CR-002 | Tạo một task, response xác nhận đến sau optimistic draft | Chỉ một task hữu hiệu được hiển thị |
| AC-04 | CR-003 | Task chưa done → Done → reopen | Done có thời điểm hoàn thành; reopen về Today và bỏ thời điểm đó |
| AC-05 | CR-004 | Bulk có thành công, bỏ qua và lỗi trong cùng lượt | Phân biệt ba kết quả, không báo mọi task thành công |
| AC-06 | CR-005 | Tạo list rồi avatar update thất bại | Không coi list chưa từng được tạo; phản ánh bước hậu kỳ thất bại |
| AC-07 | CR-005 | Archive rồi restore list | List chuyển đúng tập; tác động task con không được tự suy |
| AC-08 | CR-006 | Rename subtask thành rỗng; thêm rồi Escape | Tên cũ giữ nguyên; draft mới bị bỏ |
| AC-09 | CR-006 | Toggle một subtask, reorder hai mục rồi drop cùng vị trí | Progress đổi đúng; thứ tự đổi ở drop hợp lệ, cùng vị trí no-op |
| AC-10 | CR-007 | Sửa notes liên tiếp trong dưới 300 ms rồi blur | Có flush thay đổi cuối; không mất draft chỉ vì debounce còn chờ |
| AC-11 | CR-008 | Task A đang work Pomodoro, chuyển B giữa sprint | Interval task đổi; sprint elapsed không tự reset |
| AC-12 | CR-008/009 | Launch lại task running, rồi pause/resume | Không tạo interval thừa khi running; thời gian paused bị loại khỏi elapsed |
| AC-13 | CR-010 | Preview từ running, cancel; lặp lại từ paused | Chỉ trường hợp trước đó running tự resume |
| AC-14 | CR-010 | Preview A rồi chuyển B; stale cancel A đến | Không đổi timer của B |
| AC-15 | CR-011 | Đủ sprint thứ N ở chu kỳ long break | Chọn long break đúng mốc; không suy auto-Done task |
| AC-16 | CR-011 | Đặt break bằng 0, âm hoặc không hữu hạn | Từ chối tại luồng đặt duration; giá trị cũ không thành duration sai |
| AC-17 | CR-012 | Đang running/paused trong focus rồi về Dashboard | Timer dừng, khoảng làm trước được đưa vào luồng ghi |
| AC-18 | CR-012 | Restore running hoặc interruption >60 giây | Recovery paused; không cộng vô hạn thời gian mất quan sát |
| AC-19 | CR-012 | Interval 999 ms và 1000 ms | Mốc dưới 1 giây bị bỏ; mốc 1 giây đủ điều kiện ghi |
| AC-20 | CR-013 | First observation đã quá hạn; sau đó kéo dài và crossing mới | Không cue cho observation cũ; cue có thể re-arm ở crossing mới |
| AC-21 | CR-014 | Hôm nay thứ Hai, chọn Next Week | Ngày thứ Hai sau 7 ngày; không chọn hôm nay |
| AC-22 | CR-014 | Later Today lúc 23:40 | Cho phép kết quả sang ngày hôm sau theo phép làm tròn |
| AC-23 | CR-015 | Hai khoảng kết thúc/bắt đầu cùng thời điểm | Không conflict chỉ vì chạm biên |
| AC-24 | CR-015 | Reminder mới cách now 4:59 và đúng 5:00 | Từ chối trường hợp đầu, chấp nhận trường hợp sau trong guard đã đặc tả |
| AC-25 | CR-016 | Sửa title parent lặp, cancel/chọn phạm vi | Cancel không áp pending; lựa chọn scope được giữ rõ; merge server BLOCKED nếu thiếu contract |
| AC-26 | CR-017 | Unread 100; mở feed rồi nhận response cũ sau refresh mới | Badge 99+, accessible count 100; response cũ không đè kết quả mới |
| AC-27 | CR-017 | Reminder được kiểm đúng đầu và cuối cửa sổ 90 giây | Đầu đủ điều kiện, cuối không; delivery OS kiểm riêng |
| AC-28 | CR-018 | Chọn 7d, đổi filter hai lần, response trả ngược | Range gồm 7 ngày lịch; chỉ lựa chọn cuối thắng |
| AC-29 | CR-019 | Hai thứ Hai, một ngày 60 phút, một ngày zero | Weekday average 30 phút |
| AC-30 | CR-019 | Accuracy ba bucket bằng nhau trên tổng ba | Làm tròn độc lập được 33% mỗi bucket; không ép giả 100% |
| AC-31 | CR-020 | Edit session end=start, rồi double submit hợp lệ | Trường hợp end=start bị chặn; busy ngăn submit trùng |
| AC-32 | CR-020 | Export >100 sessions với quote/newline/formula-like titles | Xuất mọi trang filter, cell được escaping; đổi filter giữa export bỏ kết quả stale |
| AC-33 | CR-021 | Local preferences hiện trước, user edit, cloud cũ đến | Cloud cũ không ghi đè edit; có saving/error state |
| AC-34 | CR-021 | Edit rồi đóng trong 450 ms | Flush lượt debounce đang chờ trước yêu cầu đóng |
| AC-35 | CR-022 | Chọn System, đổi OS theme, đổi brand | Appearance theo OS nhưng lựa chọn vẫn System; brand không đổi lựa chọn đó |
| AC-36 | CR-022 | Chọn preview Tower | Không chuyển timer session thực sang Tower chỉ vì preview |
| AC-37 | CR-023 | Close main chưa quit, rồi mở lại từ tray | Main ẩn rồi hiện, không tự xem close là complete task |
| AC-38 | CR-023 | Màn hình Tower đã lưu biến mất | Dùng fallback và biểu đạt sự thay thế; OS geometry kiểm riêng |
| AC-39 | CR-024 | Đang edit shortcut rồi Escape | Hủy edit/restore binding; Settings không đóng bởi cùng Escape |
| AC-40 | CR-024 | Register binding mới thất bại, restore cũ cũng thất bại | Báo lỗi hai bước; không hiển thị như lưu thành công |
| AC-41 | CR-024 | Add-task shortcut khi focus trong input; Done shortcut khi break | Không kích hoạt hành động sai context |

## Chưa thể nghiệm thu là tương đương

Không có tiêu chí pass cho exact pixel, remote aggregate formulas, migration, authorization/billing/license, recurrence engine, toàn bộ offline/idempotency hay voice AI. Các phần này cần đặc tả bổ sung. Hai quy tắc HELP-only (Today eligibility và live editing restrictions) cần kiểm chứng build trước khi chuyển thành acceptance bắt buộc.
