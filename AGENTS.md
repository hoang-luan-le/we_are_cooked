# Incident Lab · Frontend Agent Board của Tung

Dùng một [GitHub Issue](https://github.com/thanhtungnguyen-dev/we_are_cooked/issues/1) để giao việc, bàn giao và duyệt phần frontend. Repo làm việc là `thanhtungnguyen-dev/we_are_cooked`. Tung duyệt tích hợp lên `main` của fork và việc đưa frontend về repo team.

| Role | Phạm vi | Nhánh | Báo cáo |
| --- | --- | --- | --- |
| `sol` | Landing, frontend runtime, integration và tests trong `apps/web/` | `branch-codex` | `reports/codex.md` |
| `argon` | Layout, theme, motion, review UI, và asset trong `design/frontend/` khi được giao | `branch-argon` | `reports/argon.md` |
| `opus` | Polish scene, asset và movement theo task Tung giao sau khi mở Phase 06 | `branch-claude` | `reports/claude.md` |
| `tung` | Giao việc, kiểm bằng chứng, duyệt và tích hợp | `main` | Comment trên board |

Backend, AI/voice và các phần khác thuộc team. Các agent frontend chỉ chỉnh phạm vi của mình. Theo Working Plan v6, Tung chỉ giao một agent chỉnh file tại một thời điểm.

## 1. Nhận việc và bàn giao

1. Đọc file này từ `main` và mở Issue Board trước khi làm. Tung cấp việc bằng comment có `To:` đúng role và `Status: ASSIGN` hoặc `Status: FIX_REQUIRED`. Tung có thể ghi trước thứ tự agent cho cùng phase. Trong trường hợp đó, role kế tiếp chỉ bắt đầu sau khi nhận `HANDOFF` có SHA và Task ID khớp lệnh của Tung. Dùng Task ID để tránh chạy lại việc đã bàn giao.
2. Kiểm tra repo và nhánh. Fetch `origin/main`, đồng bộ nhánh riêng và dừng nếu có xung đột hoặc thay đổi ngoài phạm vi. Agent chỉ commit và push nhánh mình. Tung quyết định merge và mở bước kế tiếp.
3. Tìm và dùng lại trước khi tạo. Với asset, ghi nguồn và giấy phép. Với Night 2D, tách kiểm thử fixture khỏi xác minh API thật.
4. Sau khi push và xác nhận commit có trên GitHub, đăng một comment ngắn. Dùng `NEED` khi thiếu đầu vào. Khi xong, dừng chỉnh file và ghi SHA, link báo cáo tại SHA cùng kết quả checks. Dùng `HANDOFF` cho role kế tiếp đã được Tung cấp quyền hoặc `READY_FOR_REVIEW` gửi Tung khi tới bước duyệt. Board công khai. Giữ tài liệu nội bộ và credentials ở kênh riêng.

```text
From: sol
To: tung
Task: <task-id>
Status: READY_FOR_REVIEW

Đã làm: <tóm tắt>
Bằng chứng: <SHA, link báo cáo và checks>
Cần duyệt: <điểm cần xác minh>
```

Tag theo role bằng `To:`, kể cả khi các agent dùng chung GitHub login. Nếu có GitHub CLI, xem comment bằng `gh issue view 1 --repo thanhtungnguyen-dev/we_are_cooked --comments`. Có thể đọc và đăng trực tiếp trên GitHub hoặc qua công cụ GitHub sẵn có trong agent.

## 2. Giải trình kỹ thuật cho PM

Dòng 1 là `STATUS: READY_FOR_REVIEW` nếu hoàn tất, hoặc `STATUS: BLOCKED` nếu bị kẹt. Dòng 2 là `COMMAND_ID: <Task ID trên board>`. Ghi **task, commit nền, file/hàm/component, đầu vào tái sử dụng, lệnh kiểm tra và kết quả**, cùng những phần còn thiếu bằng chứng. Gắn link source theo SHA khi đã push. Khi báo một thiết kế, phân biệt quyết định đề xuất với hành vi đã triển khai.

### A. Full-Stack / React

- Chọn các quyết định đáng giải thích. Với mỗi hook, API, component hoặc kỹ thuật, chỉ đúng file và hàm. Viết hành vi người dùng mà nó phục vụ và lúc nào code chạy.
- Mô tả luồng bằng vài bước. Với `useEffect`, nêu dependency nào tạo đồng bộ, cleanup chạy khi nào và vì sao công việc thuộc effect thay vì render hoặc event handler. Với thay đổi full-stack, lần theo UI → request → response → state khi có.
- Giải thích một cách triển khai khác đã cân nhắc, vấn đề nó sẽ gặp trong tình huống này và khi nào có thể dùng cách đó.

### B. Data Structures & Algorithms

- Chỉ đúng dữ liệu, thao tác thường dùng và hàm thực hiện. Định nghĩa các biến như `n` và `q`. Cho một ví dụ đầu vào nhỏ để Tung lần theo.
- Tính time và space cho cả bước chuẩn bị lẫn truy vấn lặp lại. Ghi giả định về trường hợp trung bình, worst case hoặc khấu hao nếu có. So với cách đơn giản hơn và nói ở quy mô nào đáng đổi.
- Nếu task không có thuật toán đáng phân tích, ghi N/A cùng lý do. Không thêm cấu trúc dữ liệu chỉ để có nội dung báo cáo.

### C. System Design & Architecture

- Nêu vấn đề, ràng buộc, nguồn dữ liệu có thẩm quyền và luồng bình thường. Đi qua một tình huống lỗi như timeout, dữ liệu cũ, retry hoặc mất kết nối nếu liên quan.
- So với một phương án khả thi theo cùng tiêu chí, chẳng hạn độ phức tạp vận hành, độ trễ, tính nhất quán hoặc khả năng kiểm thử. Giải thích điều kiện có thể làm lựa chọn thay đổi.
- Ghi rõ bằng chứng là mockup, fixture, browser, integration hay quan sát thật. Nêu phần nào còn là giả định.

Kết mỗi báo cáo với **một câu hỏi Tung tự giải thích lại** và **một cách kiểm chứng ngắn** có lệnh hoặc thao tác cụ thể. Tránh lặp lại cùng một giải thích trong nhiều mục.

