# Bảng điều phối frontend · Incident Lab v6

- **Phase hiện tại:** 01 · Nền và luồng Night 2D
- **Trạng thái chung:** PAUSED
- **Người điều phối:** Tung
- **Repo điều phối:** `thanhtungnguyen-dev/we_are_cooked`
- **Agent chỉnh file:** CODEX

Tung đổi trạng thái chung thành `IN_PROGRESS` khi muốn bắt đầu. Chỉ một agent chỉnh file cho Tung tại một thời điểm. Agent khác có thể review trong chat. Trước khi chuyển quyền chỉnh file, xác nhận phiên cũ đã dừng, cập nhật writer, lane và Command-ID trên `main`. Dùng ID mới cho task mới hoặc yêu cầu sửa.

## CODEX · GPT-6.1 Sol

- **Branch:** `branch-codex`
- **Report:** `reports/codex.md`
- **Status:** WORKING
- **Command-ID:** `01-CODEX-01D-02`
- **Task:** Kiểm tra code và contract hiện có trên GitHub. Dựng hoặc dùng lại nền Next.js tối thiểu cho luồng Night. Ưu tiên đường đi từ call screen đến dashboard, logs, deploy diff và rollback có recovery. Landing chỉ cần đường vào rõ ràng để kiểm tra luồng này. Chuẩn bị điểm nối captions và text cùng Luan theo hợp đồng đã xác nhận.
- **Đầu vào:** Duy cung cấp API URL, demo incident ID, cách xác thực và ví dụ action. Đọc contract đã có nếu tìm được. Dùng dev fixture có nhãn khi thiếu đầu vào để làm phần UI. Giữ việc xác minh API thật là mục riêng.
- **Tiêu chí bàn giao:** Lệnh khởi động, build/typecheck và smoke test browser. Tách bằng chứng màn hình chạy bằng fixture khỏi kết quả test API thật. Khi có API, đi qua Answer, đọc thông tin incident, rollback thử trên incident được cấp và xác nhận charts phục hồi cùng trạng thái discounts OFF.
- **Yêu cầu sửa từ PM:** Chưa có.

## ARGON · Gemini 4

- **Branch:** `branch-argon`
- **Report:** `reports/argon.md`
- **Status:** ON_HOLD
- **Command-ID:** —
- **Task:** Khi Tung nhờ, review trong chat về call screen, dashboard, chữ NIGHT PAIR / MORNING PAIR, handoff bốn mục và tương tác keyboard/mobile. Khi Tung chuyển writer và cấp lệnh mới, mới chỉnh design files.
- **Yêu cầu sửa từ PM:** Chưa có.

## CLAUDE · Opus 5.5

- **Branch:** `branch-claude`
- **Report:** `reports/claude.md`
- **Status:** ON_HOLD
- **Command-ID:** —
- **Task:** Chờ P0 2D qua rehearsal, Tung mở Phase 06 và Sol bàn giao scene chạy được. Tinh chỉnh scene, ánh sáng và chuyển động trong phạm vi Tung giao.
- **Yêu cầu sửa từ PM:** Chưa có.

## Thứ tự triển khai P0 trên frontend

| Thứ tự | Nhiệm vụ | Bằng chứng |
| --- | --- | --- |
| 1 | Night 2D | Call, charts, logs, deploy diff và rollback. Giữ đường captions, keyboard và text fallback. Bổ sung chọn level, tooltip và checklist Explore trước rehearsal P0. |
| 2 | Banners và shift handoff | NIGHT PAIR và MORNING PAIR. Night nhập bốn mục: chuyện gì xảy ra, trạng thái hiện tại, đã thử gì, rủi ro còn lại. Morning đọc note cùng timeline và team chat, rồi đánh giá usefulness 1–5 và một dòng feedback. Vai trò demo theo v6 là Lead, Investigator, Author và Reviewer. |
| 3 | Morning PR | Real PR, CI và review qua API. Hiện mentor có tên và nhãn khi đã xác nhận và đồng ý. |
| 4 | Debrief và network | Rubric, before/after, evidence, mutual connection, cohort join code và member list. Dùng snapshot việc làm có nguồn và ngày cho demo P0. |
| 5 | Rehearsal | Chạy Night → Handoff → Morning → Debrief và Network bằng hai cặp khi có thể. Ghi rõ nếu demo dùng fallback. |

Cohort join/member và handoff là P0 trong v6. Xác nhận contract với Duy trước khi tích hợp. Live jobs trên evidence, Next real fix qua `GET /api/next-fixes`, rotation và 3D office nằm sau P0. Maintainer review của dự án open-source nằm ở phần pitch. 3D chỉ mở khi Tung cấp lệnh riêng sau khi luồng 2D ổn.
