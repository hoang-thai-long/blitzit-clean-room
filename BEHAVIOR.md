# Đặc tả hành vi độc lập

Mọi quy tắc CR-001…024 là **CONFIRMED-static**, với phần chưa rõ ghi riêng. Đây là mô tả kết quả và tương tác, không chỉ định kiến trúc hay thuật toán nội bộ. Các tên màn hình/nút là nhãn người dùng để phân biệt thao tác.

## Công việc và danh sách

### CR-001 — Tổ chức công việc
Board có Backlog, This Week, Today và Done. Today được nhấn mạnh. Trạng thái hoàn thành, lưu trữ và xóa phải được phân biệt. Task cha lặp chưa hoàn thành xuất hiện trong Backlog; mục nghỉ chỉ tham gia board này khi ở Done. Tập kết quả tìm kiếm/lọc không mặc nhiên có cùng khả năng kéo sắp xếp với tập đầy đủ.

### CR-002 — Tạo và sửa task
Tiêu đề sau khi bỏ khoảng trắng đầu/cuối rỗng thì không submit tại form thêm. Có thể thấy bản nháp trước khi lưu được xác nhận; bản nháp và bản đã xác nhận không được cùng xuất hiện như hai task độc lập. Thông báo/hiển thị lưu đang chờ không phải bằng chứng lưu remote thành công. Sửa chỉ các thuộc tính đã thay đổi; xóa nội dung notes, estimate hay toàn bộ subtasks có nghĩa riêng, không coi là “không chỉnh sửa”. Kết quả dưới mất mạng/crash còn UNKNOWN.

### CR-003 — Hoàn thành và mở lại
Đánh dấu hoàn thành chuyển task sang Done và ghi thời điểm hoàn thành. Mở lại đưa task về Today, bỏ thời điểm hoàn thành và sắp vị trí theo luồng mở lại. Hoàn thành mọi subtask không được mặc nhiên coi là hoàn thành task cha; chưa xác nhận quy tắc tự hoàn thành cha trên toàn app. Thứ tự chính xác của task vừa mở lại cần bổ sung.

### CR-004 — Thao tác hàng loạt
IDs trùng trong lựa chọn không được tính là các task độc lập. Không chọn task là no-op. Kết quả có thể thành công một phần, bỏ qua một phần hoặc chưa xác nhận một phần; phải giữ được sự phân biệt, không báo tất cả thành công hay tự hoàn tác phần đã thành công chỉ vì phần khác lỗi.

### CR-005 — Vòng đời list
Có tạo, đổi tên, sắp thứ tự, archive/restore và xóa list. Có thể tạo list xong trước khi avatar/thứ tự hậu kỳ được xác nhận. List đã archive vẫn có thể được dùng để giải tên trong dữ liệu liên quan. “Duplicate” trong luồng khảo sát sao chép tên có hậu tố Copy và hình/màu list; chưa có cơ sở yêu cầu sao chép mọi task. Tác động xóa/archive lên dữ liệu con còn UNKNOWN.

### CR-006 — Subtasks
Thêm subtask bỏ khoảng trắng, không chấp nhận tiêu đề rỗng. Rename rỗng khôi phục tên cũ và thoát sửa, không xóa mục. Enter xác nhận thêm; Escape bỏ bản nháp thêm. Toggle từng mục cập nhật tiến độ done/total; có xóa và kéo đổi thứ tự. Drop không có đích hoặc cùng vị trí là no-op. Notes và due date của subtask riêng với notes/lịch của task cha. Khả năng giữ mọi chi tiết subtask ngay lúc tạo task mới chưa được xác nhận.

### CR-007 — Notes
Task có ghi chú Markdown. Editor trì hoãn thông báo thay đổi khoảng 300 ms; rời editor có thay đổi đang chờ thì flush. Không thay nội dung thì không tạo thao tác sửa ở luồng focus. Task notes và subtask notes là hai nội dung riêng. Cách xử lý khoảng trắng khác giữa các entry point; không tự chuẩn hóa mọi editor giống nhau. Lưu bền khi crash và sanitation còn UNKNOWN.

## Timer và focus

### CR-008 — Chạy và đổi task
Chạy lại task hiện tại đang running không mở interval mới; nếu paused và session còn tiếp tục được thì resume. Chọn task khác ghi nhận khoảng làm trước và chuyển sang task mới ở work/running. Nếu đang Pomodoro work, thời gian sprint đã làm được giữ qua đổi task. Bỏ chọn task trở về idle. Kiểm tra quyền truy cập có thể chặn launch.

### CR-009 — Pause/resume
Pause đóng băng elapsed; resume tiếp tục mà loại thời gian pause khỏi thời gian làm. Không cho elapsed âm. Idle hoặc chưa có start không toggle pause. Completion preview có quy tắc riêng ở CR-010. Thay đổi đồng hồ hệ thống/race cần kiểm runtime.

### CR-010 — Completion preview
Mở preview hoàn thành cho task đang active/work tạm dừng nếu đang chạy. Hủy preview chỉ tự resume nếu trước đó đang chạy và thao tác vẫn thuộc task hiện tại. Task vốn paused phải tiếp tục paused. Yêu cầu hủy stale của task trước không thay trạng thái task mới. Confirm preview chưa tự chứng minh task đã được lưu Done thành công.

### CR-011 — Pomodoro và nghỉ
Khi Pomodoro bật và work đạt độ dài sprint, chuyển sang nghỉ theo chu kỳ. Có short break, long break và số sprint trước long break. Không có task active thì về work/idle. Thời lượng nghỉ không hữu hạn hoặc không dương bị từ chối tại luồng đặt thời lượng; giá trị hợp lệ được làm tròn phút, tối thiểu một phút. Chưa xác nhận mọi break hết giờ tự chạy work hoặc tự hoàn thành task.

### CR-012 — Rời focus, khôi phục và ghi thời gian
Về Dashboard từ session surface dừng timer và yêu cầu ghi khoảng thời gian trước đó, kể cả trường hợp đang paused trong nhánh khảo sát. Khôi phục thông thường của session đang running đưa về paused. Gián đoạn quan sát dài hơn 60 giây có recovery pause tại điểm quan sát trước. Interval dưới một giây không được ghi; thời gian làm loại trừ pause. Tọa độ end của interval có thể là start cộng thời gian thực làm, không phải thời điểm bấm stop trên đồng hồ. Độ bền sau crash và tính đúng một lần còn UNKNOWN.

### CR-013 — Cảnh báo thời gian
Nhắc theo interval phát khi vượt sang mốc tiếp theo, không phát lại hàng loạt cho mọi mốc đã bỏ qua. Cảnh báo hết break/overtime dựa trên crossing: lần đầu quan sát một session vốn đã quá hạn không tự phát lại. Kéo dài break để chưa hết có thể cho phép cue ở lần crossing sau. Setting âm thanh có thể tắt cue. Có lời gọi phát không chứng minh thiết bị đã phát âm.

## Lịch và thông báo

### CR-014 — Quick scheduling
Default time cùng ngày là khoảng now+10 phút, làm tròn lên phút; ngày khác mặc định 09:00 local. Later Today lấy khoảng now+60 phút rồi làm tròn gần nhất đến mốc 30 phút; gần nửa đêm có thể sang ngày sau. Tomorrow và Next Week chọn ngày không bật giờ; Next Week là thứ Hai tiếp theo, nếu hôm nay thứ Hai thì sau 7 ngày. Date-only không đồng nghĩa “không có ngày”.

### CR-015 — Conflict và reminder
Hai khoảng chạm đầu/cuối không conflict; khoảng có độ dài zero cần xử lý riêng, không bỏ qua tùy tiện. Tìm slot khả dụng theo mốc 30 phút; reminder không chiếm busy slot ở luồng khảo sát. Reminder bật giờ, không khóa đến do-date, phải cách hiện tại ít nhất năm phút; đúng năm phút được phép. Reminder đã lưu không đổi phút có ngoại lệ để không bị từ chối chỉ vì thời gian trôi. Deadline và do-date là hai khái niệm riêng.

### CR-016 — Recurrence
Có daily, weekday, weekly, monthly và custom. Weekly/monthly dùng ngày được chọn làm cơ sở; thiếu ngày có thể dùng ngày hiện tại. Tắt lặp bỏ vai trò template. Sửa nội dung kế thừa hoặc lịch/rule của parent có thể yêu cầu chọn phạm vi: chỉ parent/tương lai hay cả task hiện có; cancel không áp thay đổi đang chờ. Sinh occurrence, tháng ngắn/DST và merge nội dung child đã chỉnh riêng còn UNKNOWN.

### CR-017 — Notifications
Notification bell hiển thị tại Dashboard. Badge trên 99 hiện 99+, tên truy cập giữ số thật. Mở feed và nạp thành công khi vẫn đang mở thì yêu cầu đánh dấu đã đọc; lỗi cập nhật read cần reconcile. Phân trang/refresh không để response cũ ghi đè thế hệ dữ liệu mới. Reminder lịch có cửa sổ kiểm khoảng 90 giây, không có bằng chứng bắt kịp mọi reminder đã lỡ. Quyền OS và delivery thực tế còn UNKNOWN.

## Reports

### CR-018 — Range và dữ liệu báo cáo
Overview mặc định 7 ngày, gồm hôm nay và 6 ngày trước; có preset 30/90 và custom, cùng filter list. Response cũ không được đè lựa chọn mới. Không mặc nhiên cho rằng activity heatmap dùng cùng filter với overview. Các tổng work days/tasks/focus/average do nguồn báo cáo cung cấp; không tự định nghĩa lại công thức aggregate chưa biết. Khi không có completed task, average hiển thị trạng thái không có thay vì một average tự suy.

### CR-019 — Các biểu đồ
Weekday average tính cả ngày lịch không có hoạt động; giờ trong biểu đồ tương ứng số session bắt đầu, không nhất thiết tổng duration theo giờ. Accuracy percentages làm tròn từng bucket độc lập nên tổng có thể lệch 100%; thuật toán phân loại bucket còn UNKNOWN. Time by list có phần focus và phần breaks; ẩn slice thay đổi tập nhìn thấy và mẫu số tooltip. Empty chart không được diễn giải thành thời gian làm thực.

### CR-020 — Sessions và CSV
Session rows sắp thời điểm bắt đầu giảm dần; totals không chỉ cộng các rows đã tải trong trang hiện tại. Form sửa chặn end không sau start và chặn submit đồng thời; đổi ngày start giữ duration bằng cách dời end. CSV lấy toàn bộ các trang thuộc filter, không chỉ rows đang thấy; thay filter giữa export phải bỏ kết quả cũ. Nội dung quote/newline và tiền tố giống công thức được xử lý để giữ cell an toàn; phút có thể thập phân.

## Preferences, desktop và shortcuts

### CR-021 — Preferences
Mở Settings có thể áp snapshot local trước rồi nạp cloud. Response cũ không đè edit mới. Thay đổi áp dụng ngay trong UI, với autosave debounce khoảng 450 ms; đóng khi còn debounce thì flush trước yêu cầu đóng. Có loading/saving/error riêng; không coi toast “saved locally” là bằng chứng storage chắc chắn bền. Một số tab tự quản dữ liệu, không cùng cơ chế autosave chung.

### CR-022 — Appearance
Light/Dark/System là một trục, brand theme là trục khác. Mặc định dark và Blitz Green; giá trị không hợp lệ về fallback. System theo hệ điều hành nhưng vẫn giữ lựa chọn System. Brand options: Blitz Green, Atomic Flame, Electric Lime, Cosmic Indigo, Cherry Blossom Pink. Preview Dashboard/Tower/Pill là minh họa, không đổi timer đang chạy; web chỉ có Dashboard preview.

### CR-023 — Desktop surfaces
Có Dashboard, Tower, Pill, Expanded Focus, floating timer riêng và companion riêng. Đóng main thông thường ẩn thay vì quit. Tower có chọn màn hình/cạnh và free movement; thiếu màn hình đã lưu dùng fallback. Timer close có giai đoạn yêu cầu xác nhận sau khi guard sẵn sàng. Tính topmost, clamp màn hình và OS thực thi còn cần test; không coi macOS notch là tính năng Linux.

### CR-024 — Shortcut editing và context
Có nhóm Global và Tasks, enable/disable từng binding. Edit có pending/busy; Escape hủy edit và khôi phục binding thay vì đóng Settings. Đổi binding đang bật phải đăng ký mới thành công trước commit; fail thì thử restore cũ và báo nếu restore cũng fail. Task shortcuts có guard active task/view/break/preview; add-task bỏ qua khi đang nhập text. Binding mặc định được nêu trong UI.md; không khẳng định OS luôn nhận đăng ký.

## HELP-only và khoảng trống

- Tài liệu nói Blitz Now chọn task Today đầu đủ điều kiện; task có giờ còn ở tương lai không đủ điều kiện. Chưa trace đầy đủ selection caller build này, nên tiêu chí này **HELP-only**, không CONFIRMED-static.
- Tài liệu nói title task live chỉ sửa ở Notes mode, EST và Time Taken chỉ sửa khi paused. Chưa dùng đó để khẳng định mọi entry point bản build.
- Tài liệu migration nói sao chép lựa chọn từ 2.x sang 3.0, không live/two-way sync. Migration không thuộc baseline triển khai này.
- UNKNOWN: backend schema/quyền/transactions, occurrence generation, các formula aggregate server, exactly-once, offline hoàn chỉnh, pixel baseline, toàn bộ voice/AI, billing/license/auth. Không tự lấp các phần này bằng giả định tương đương.
