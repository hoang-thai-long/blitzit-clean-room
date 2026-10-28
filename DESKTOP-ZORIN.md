# Daylight Desktop cho Zorin OS — Dynamic Island + PostgreSQL

> **Daylight 1.1.0 / schema v2:** [DATABASE.md](DATABASE.md). Desktop và [REST API](API.md) dùng chung các bảng chuẩn hóa; không ghi snapshot JSONB toàn workspace. Desktop giữ workspace lock thì API đọc được nhưng ghi trả 423. Desktop vẫn dùng IPC/native PostgreSQL, không phụ thuộc API để chạy. Sau migration cần dùng bản 1.1.0 trở lên.

Phần này được triển khai theo yêu cầu bổ sung của người dùng. **Desktop, Island, cơ chế PostgreSQL/outbox là thiết kế mới**, không phải suy luận hành vi gốc từ phần UNKNOWN của bốn tài liệu clean-room. Không truy cập mã/artifact sản phẩm gốc; không có API Blitzit, product login, license hay billing.

## 1. Gói ứng dụng

Target: **Linux x86-64 / Zorin OS nền Ubuntu**, ưu tiên Zorin 17/18.

| File | Cách dùng |
|---|---|
| `release/Daylight-1.1.0-amd64.deb` | Cài/nâng cấp trong Zorin |
| `release/Daylight-1.1.0-x86_64.AppImage` | Chạy portable, không cài package |
| `release/linux-unpacked/daylight` | Bản unpacked để chạy/kiểm thử trực tiếp |

App đóng gói chứa Electron, UI React, IPC bridge và PostgreSQL client. **Không cần mở browser hoặc chạy Vite preview. PostgreSQL là dịch vụ riêng**, không nhúng database server vào executable.

Từ thư mục dự án, cài `.deb`:

```sh
sudo apt install ./release/Daylight-1.1.0-amd64.deb
daylight
```

Hoặc mở **Daylight** từ menu ứng dụng. Tên Debian package là `local-focus-workspace`; executable là `daylight`.

Chạy AppImage:

```sh
chmod +x release/Daylight-1.1.0-x86_64.AppImage
./release/Daylight-1.1.0-x86_64.AppImage
```

Nếu máy không có FUSE, dùng chế độ tự giải nén của AppImage:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 ./release/Daylight-1.1.0-x86_64.AppImage
```

Không cần Node/npm khi chỉ chạy gói cài. `homepage` trong metadata dùng miền dành riêng `example.invalid` vì đây là bản private, chưa có website phát hành.

## 2. PostgreSQL local

### Docker Compose đi kèm

Trên máy có Docker Compose và Node 22+:

```sh
npm run db:setup
npm run db:up
```

`db:setup` tạo `.env` với password ngẫu nhiên, quyền 0600, không ghi đè file đã tồn tại. `.env` nằm trong `.gitignore`. Compose chạy PostgreSQL 17, chỉ bind loopback:

- Host: `127.0.0.1`
- Port: `54329`
- Database: `daylight`
- User: `daylight`
- Password: giá trị `DAYLIGHT_DB_PASSWORD` trong `.env`
- Workspace ID: `default`
- TLS: tắt cho kết nối loopback tới container đi kèm

Nếu không có Node, tạo `.env` từ `.env.example`, thay password mẫu bằng password của bạn, rồi chạy `docker compose up -d --wait`.

Trong app mở **Desktop & PostgreSQL**, nhập thông tin trên và bấm **Connect PostgreSQL**. Thành công sẽ hiện **Đã lưu PostgreSQL**, revision và last sync. App không coi lưu local là đã lưu thành công vào PostgreSQL.

Container đã được khởi động trong phiên triển khai: `daylight-postgres-1`, cổng `127.0.0.1:54329`, persistent volume `daylight_daylight-postgres`. Không dùng database/container khác trên máy.

Quản lý dịch vụ:

```sh
docker compose ps
npm run db:down
npm run db:up
```

`db:down` giữ volume. Không dùng `docker compose down -v` nếu cần giữ dữ liệu.

### PostgreSQL đã có sẵn

Tạo database riêng và role được phép tạo/đọc/ghi bảng trong database đó, rồi nhập host/port/database/user/password trong app. Không yêu cầu schema của Blitzit.

Có thể cấu hình qua biến môi trường `DAYLIGHT_DATABASE_URL` (`postgresql://…`) và `DAYLIGHT_WORKSPACE`. URL không được đưa vào renderer hay log ứng dụng. Với PostgreSQL remote, bật TLS có xác minh certificate. Kết nối DB là native `pg` trong Electron main process, không phải HTTP API từ browser.

Password chỉ được lưu bền khi OS keyring hỗ trợ mã hóa Electron `safeStorage` và backend không phải `basic_text`. Khi keyring không khả dụng, password chỉ tồn tại trong phiên main process; phải nhập lại lần sau hoặc dùng launcher/environment. File config chỉ chứa cấu hình public và ciphertext nếu có. Không lưu password vào localStorage.

## 3. Dynamic Island

- Cửa sổ riêng, nền trong suốt, hình capsule đen ở giữa mép trên **work area** của màn hình.
- Compact: tên task, phase/status, timer và pause/resume.
- Bấm tên task hoặc mũi tên để mở rộng; expanded có Dashboard, Break/End break, Done và Hide.
- Kéo **vùng trống** để di chuyển. Các nút không phải drag region.
- Chọn màn hình trong Desktop & PostgreSQL. Màn hình ID không còn tồn tại dùng primary display fallback.
- Chuyển compact/expanded hoặc chọn màn hình sẽ căn lại giữa mép trên. Vị trí kéo tay chưa lưu qua restart; đây là thiết kế mới có chủ ý.
- Main window close → hide; timer tiếp tục chạy trong main process; Island hiện để mở lại Dashboard.
- Tray: Open Daylight, Show/Hide Island, Center Island, Quit & save.
- Quit & save flush editor, ghi interval đang chạy và thoát. **Quit không tự hoàn thành task.**

Dashboard và Island dùng **một timer owner** trong Electron main process. Island không có interval độc lập và không tự ghi snapshot. Chỉ Dashboard được IPC commit metadata; Island chỉ có timer/window commands.

Mặc định Linux chạy **X11/XWayland** để hỗ trợ vị trí cửa sổ và always-on-top. Có yêu cầu visible-on-all-workspaces. Hiệu lực trên desktop/compositor thực tế cần kiểm tra tại máy Zorin. Muốn thử native Wayland: đặt `DAYLIGHT_NATIVE_WAYLAND=1`; compositor có thể bỏ qua tọa độ hoặc topmost. Đây là floating window, không phải GNOME Shell extension hay notch phần cứng.

## 4. Dữ liệu và thiết kế mới

### PostgreSQL

App tự migrate sang schema chuẩn hóa v2: `daylight_workspace_meta`, `daylight_lists`, `daylight_tasks`, `daylight_subtasks`, `daylight_sessions`, `daylight_preferences`, `daylight_timers`. DDL và index ở `database/002-normalized.sql`; nguyên tắc migration/backup ở [DATABASE.md](DATABASE.md).

Trong bộ nhớ/UI vẫn dùng state version 1, nhưng PostgreSQL chỉ INSERT/UPDATE/DELETE các rows/columns đã đổi trong transaction. Timer tick không viết lại sessions. Bootstrap/restore dựng state từ các bảng; `daylight_workspaces` là view export tương thích, không còn cột state vật lý. Reports desktop vẫn tính từ state đã tải; reports REST được aggregate trong SQL.

- SQL parameters, không nối chuỗi input thành SQL.
- PostgreSQL advisory lock giữ một writer cho mỗi Workspace ID.
- Ghi có expected database revision; revision khác → **conflict**, không ghi đè.
- Renderer commit có expected in-process revision; stale edit được xếp hàng/retry trên snapshot hiện tại. Island không thể gửi full-state commit.
- Khi reconnect, phải đọc/kiểm base revision trước khi flush outbox; edit đang chờ vẫn được giữ.
- Cùng Workspace ID trên hai máy không phải collaboration/live sync. App thứ hai nhận trạng thái workspace đang được mở bởi app khác.

### Local outbox

Desktop không dùng browser localStorage làm nguồn lưu chính. File trong Electron userData (thông thường `$XDG_CONFIG_HOME/Daylight` hoặc `~/.config/Daylight`):

- `workspace-cache.json`: state + dirty flag + database identity/base revision.
- `database-config.json`: cấu hình kết nối/ciphertext nếu keyring khả dụng.
- `desktop-settings.json`: Island visible/display ID.
- `workspace-backup-<timestamp>.json`: backup trước khi người dùng chọn tải bản PostgreSQL khi conflict.

App ghi file tạm rồi rename, quyền 0600; PostgreSQL flush được lên lịch khoảng 500 ms. Timer chính tick khoảng một giây. Lỗi ghi cache từ chối edit thay vì báo đã lưu. Cache không hợp lệ được giữ nguyên và chặn ghi cho đến khi được khôi phục.

Mất DB → local outbox; tự reconnect mỗi 15 giây hoặc **Retry sync**. Nếu revision remote đã đổi trong thời gian offline, không tự merge. Nút **Backup local & load PostgreSQL** giữ bản local trong backup rồi chọn bản DB.

Cold restart phục hồi timer **paused**; suspend máy cũng pause. Renderer reload trong cùng một desktop process chỉ nối lại timer hiện tại, không tạo timer mới. Quy trình quit thông thường cho renderer tối đa 3,5 giây để flush draft trước khi main stop/save. Crash/power loss, exactly-once và multi-writer vẫn không được chứng nhận.

Dữ liệu browser web cũ không tự nhập vào desktop/PostgreSQL. Không có migration tài khoản. Bản desktop mới dùng seed khi cả DB và cache chưa có dữ liệu.

## 5. Chạy từ source

```sh
npm ci
npm run db:setup
npm run db:up
npm run desktop:build
npm run desktop:local
```

`desktop:local` dùng `.env` để đưa kết nối local vào Electron, không in password ra log. Chạy từ terminal trong phiên GUI Zorin. Nếu chỉ dùng app không cấu hình DB trước: `npm run desktop:start`, sau đó cấu hình trong UI.

Đóng gói lại:

```sh
npm run package:linux
```

Kiểm thử:

```sh
npm test
npm run test:postgres
npm run test:e2e
xvfb-run -a -s "-screen 0 1600x1100x24" npm run test:desktop
```

Kiểm thử trực tiếp AppImage đã build:

```sh
APPIMAGE_EXTRACT_AND_RUN=1 \
DAYLIGHT_TEST_EXECUTABLE="$PWD/release/Daylight-1.1.0-x86_64.AppImage" \
xvfb-run -a -s "-screen 0 1600x1100x24" npm run test:desktop
```

Các desktop tests dùng userData tạm và Workspace ID ngẫu nhiên, xóa đúng dữ liệu kiểm thử sau khi hoàn tất. Test ngắt kết nối chỉ nhắm PostgreSQL session có application_name của workspace test. Sandbox Chromium được tắt bằng cờ launch **chỉ trong harness Xvfb**; executable sản phẩm không tự thêm cờ đó. Context isolation, sandbox web preference, Node integration off, CSP và IPC sender checks được cấu hình trong app.

## 6. Kết quả và giới hạn

- Build TypeScript/React/Electron và đóng gói `.deb`/AppImage thành công.
- 35 unit tests PASS.
- 5 integration tests với PostgreSQL thật PASS: lưu/tải profile mới, offline reconnect, revision conflict/backup, single writer, edit trong reconnect.
- 13 browser E2E tests PASS, giữ hoạt động của bản web.
- 3 desktop E2E tests PASS ở source và packaged runtime; bản AppImage chạy bằng extract-and-run cũng PASS.
- Đã xem screenshot Island expanded và cấu hình PostgreSQL; hình ở `desktop-test-results/`.
- Chưa cài `.deb` bằng sudo vào hệ điều hành host, chưa test tray click/drag bằng chuột thật, chưa test Zorin desktop vật lý, multi-monitor hot-unplug, native Wayland, keyring persistence thực tế hoặc FUSE mount của AppImage. Không đánh dấu những việc này PASS.

Các UNKNOWN/HELP-only và phần ngoài phạm vi của bản web vẫn giữ nguyên, trừ khả năng desktop mới được mô tả rõ ở đây. “Dynamic Island” này không khẳng định tương đương Tower/Pill/companion trong đặc tả cũ.
