# Bàn giao clean-room — đặc tả hành vi Blitzit 3.0.52

Chỉ giao **bốn file trong thư mục này** cho phiên triển khai mới:

1. `README.md`: phạm vi, mức tin cậy và ranh giới bàn giao.
2. `BEHAVIOR.md`: hành vi, điều kiện, chuyển trạng thái và tình huống biên.
3. `UI.md`: mô tả giao diện bằng lời.
4. `ACCEPTANCE.md`: kịch bản nghiệm thu dự kiến.

Đây là đặc tả diễn giải độc lập từ khảo sát tĩnh. Không có code gốc, bundle, source map, asset, đoạn code sao chép, schema triển khai hoặc endpoint dịch vụ. Phiên triển khai không được cấp workspace phân tích hay các ledger nguồn; chỉ nhận thư mục này trong workspace mới. Mối nối với bằng chứng được giữ ở phía phân tích, ngoài bộ bàn giao.

## Mức tin cậy

- **CONFIRMED-static:** có quy tắc trong artifact được khảo sát; chưa chạy ứng dụng để xác nhận.
- **INFERRED:** diễn giải từ nhiều dấu hiệu; không phải baseline pixel hay bảo đảm runtime.
- **UNKNOWN:** chưa xác định được; không được tự coi phương án triển khai là hành vi gốc.
- **HELP-only:** được tài liệu công khai mô tả, chưa nối đủ với build 3.0.52.

Đây là baseline có giới hạn cho lists/tasks/notes/focus/lịch/reports/preferences. Không phải chứng nhận tương đương toàn app. Tất cả tiêu chí nghiệm thu hiện **NOT RUN**. Backend, đăng ký hệ điều hành, độ bền storage, pixel và race nhiều cửa sổ cần kiểm chứng bổ sung. Cơ chế license, xác thực, thanh toán và migration dữ liệu tài khoản chưa được đặc tả để triển khai trong baseline này.

Không bắt buộc tái tạo lỗi lưu dữ liệu hay failure anomalies. Những nơi chưa rõ phải được quyết định như yêu cầu sản phẩm mới hoặc chờ bổ sung đặc tả; không ghi chúng thành hành vi gốc đã xác nhận.
