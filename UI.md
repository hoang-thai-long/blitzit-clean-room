# Mô tả giao diện độc lập

## Workspace chính

**CONFIRMED-static:** sidebar dọc có nút thu/mở, tìm kiếm, Reports, All lists, list/project, Shared và Archive. Thu sidebar ẩn tên dài, có tooltip bên phải và nhãn truy cập cho control. Khi lọc danh sách, kết quả được trình bày phẳng; không giữ ngầm khả năng sort của cây đầy đủ.

Board nằm trong vùng cuộn ngang, bốn cột Backlog / This Week / Today / Done; Today nổi bật. Card thể hiện task, thời gian và các control nghiệp vụ theo context. Done có vùng archive mở/đóng riêng. Chế độ read-only làm nhạt board, không cấp thao tác thêm/drag; mức làm nhạt không tự thay thế kiểm quyền.

Màn hình riêng có Settings, Reports, list/project. Login và các màn hình callback/invitation có trong cấu trúc, nhưng nội dung và quyền truy cập chưa được đặc tả ở đây.

## Settings

**CONFIRMED-static:** page hoặc modal ở giữa với overlay tối/blur; phiên bản Tower phủ toàn vùng, có Back to tasks, Saving và vùng cuộn compact.

- Nhóm Account: Account, Billing.
- Workspace: Preferences, Notifications, Appearance, Tags, Shortcuts.
- Blitzy: Memory; Connections: Integrations; Advanced: Developer.
- Hàng setting có label, icon tùy chọn, mô tả và control. Switch thường bên phải, có biến thể bên trái. Các tùy chọn con chỉ hiện khi switch cha bật; ẩn control không có nghĩa xóa giá trị đã chọn.
- General có ngôn ngữ/múi giờ; ẩn/hiện thời gian task, tự parse estimate từ title, hiển thị toàn title. Desktop có wake/login và chọn panel screen/side/free movement.
- Pomodoro bật mới hiện Work sprint, Short break, Long break và số sprint trước long break. UI input nhận max lần lượt 120/60/60 phút; enforcement mọi entry point còn UNKNOWN.
- Success screen bật mới hiện GIF; bật GIF mới hiện chi tiết GIF. Notifications có loading/saving, master suggestions và từng loại; hàng muted chưa chắc disabled.
- Appearance có Color Mode, Theme và Preview. Preview chọn Dashboard/Tower/Pill trên desktop; web chỉ Dashboard. Dùng swatch + tên + dấu chọn, không chỉ màu để diễn đạt selection.

## Focus và companion

**CONFIRMED-static:** Tower/Pill/Expanded là các surface focus khác nhau. Floating timer là cửa sổ riêng với trạng thái close guard. Companion là cửa sổ riêng, bắt đầu connecting, có status live region, khuôn mặt, waveform, caption và voice controls. Lỗi thay mute bằng Retry; mute chỉ dùng được khi live và chưa closing. Caption có nhãn người nói, tối đa hai dòng. Drag và pat khuôn mặt khác nhau; control tương tác khác không khởi drag. Nội dung voice service chưa xác nhận.

## Shortcut mặc định

M = Command trên Mac, Ctrl trên Windows/Linux. Option trên Mac tương ứng Alt trên Windows/Linux. Đây là default khai báo, không phải chứng nhận đăng ký OS thành công.

| Hành động | Phím |
|---|---|
| Open Blitzy pet | Ctrl + Option/Alt + Space |
| Blitz Now | M + Shift + B |
| Tower/Pill | M + Shift + T |
| Dashboard | M + Shift + H |
| New List | M + Shift + L |
| Search | M + Shift + O |
| Find Pill | M + Shift + F |
| Preferences | M + Shift + dấu phẩy |
| Add task | M + Shift + A |
| Break | M + Alt + Shift + B |
| Pause/resume | M + Shift + P |
| Skip | M + Shift + S |
| Next task | M + Alt + Shift + N |
| Done | M + Shift + D |
| Notes của active task | M + Shift + N |

## Ngôn ngữ thị giác và giới hạn

**INFERRED:** workspace nền trung tính, panel/card có viền nhẹ, góc bo, chữ phân cấp; màu nhấn theo brand; dark mode đổi nền/chữ riêng với accent. CSS tham chiếu Inter cho sans và Kode Mono cho mono; font render thực tế chưa được quan sát. Phiên triển khai tự cung cấp font/assets hợp lệ, không nhận asset gốc qua bàn giao này.

**UNKNOWN:** pixel geometry chính xác, DPI, bóng/clipping, hit areas, animation cuối cùng và reduced-motion toàn ứng dụng. Không đặt tiêu chí pixel-perfect từ báo cáo tĩnh này. Cần screenshot baseline mới trước khi khóa visual acceptance.
