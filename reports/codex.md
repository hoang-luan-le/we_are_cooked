STATUS: READY_FOR_REVIEW
COMMAND_ID: 01-NIGHT-2D-01

# Night 2D handoff

Nhánh `branch-codex` sửa các lỗi Phase 01 đã review tại [`686fe4a`](https://github.com/thanhtungnguyen-dev/we_are_cooked/tree/686fe4aef7f3276e4aa2db7a87278df5fabed21c) và đồng bộ [`main` tại `e83d7e7`](https://github.com/thanhtungnguyen-dev/we_are_cooked/tree/e83d7e7b000760da2aba85221af21dee1c56be42) để dùng contract Dana của Luan. [Frontend Agent Board](https://github.com/thanhtungnguyen-dev/we_are_cooked/issues/1)

## A. Full-stack và React

- [`Home`](../apps/web/app/page.tsx) đưa người dùng vào [`NightPage`](../apps/web/app/night/page.tsx). Route mở demo trong development hoặc khi người vận hành bật `NIGHT_FIXTURES=1` trên bản build. Origin loopback đã cấu hình chọn **Local demo API**, còn `?fixture=1` chọn **Development fixture**. Bản build mặc định hiển thị trạng thái unavailable. [`next.config.mjs`](../apps/web/next.config.mjs) đặt root ở monorepo để dùng trực tiếp các contract TypeScript. [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation) · [Turbopack root](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory)
- [`NightRun`](../apps/web/app/night/night-run.tsx) bắt đầu relay text hoặc voice từ lựa chọn trên màn hình cuộc gọi đến. Voice chuẩn bị audio context ngay trong thao tác có chủ đích. Socket và yêu cầu mic chờ backend chấp nhận `answer`. Effect theo `visibleStage` chuyển focus sau khi heading mới được render. Effect theo `visibleStage` và `briefing.state` mở dashboard khi nhận kết thúc đã drain, dùng trạng thái API mới nhất để gửi `open_panel:dashboard`. Cleanup đóng kết nối khi rời briefing.
- [`useNightApi`](../apps/web/app/night/use-night-api.ts) đồng bộ với backend qua [`/api/night`](../apps/web/app/api/night/route.ts). Effect theo `enabled` và `read` bắt đầu đọc state mỗi 2 giây rồi dọn interval và hủy request khi rời route. User action hủy poll đang chờ, gửi `ActionRequest` qua proxy cùng origin, nhận `ActionResponse`, rồi cập nhật snapshot. Proxy chỉ gửi action được hỗ trợ đến `inc_demo` ở loopback, với demo user cấu hình phía server.
- [`IncidentBoard`](../apps/web/app/night/incident-board.tsx) lấy quyền mở panel và rollback từ state API. Dialog xác nhận target `v2.13.9`. API mode chờ `phase`, metrics và `loyalty_discounts` từ backend để hiển thị kết quả. Trong fixture, confirm đặt `step=0` và effect theo `step` lên lịch đúng một mẫu tiếp theo. Effect hủy timer khi step đổi hoặc component unmount.
- [`useDanaBriefing`](../apps/web/app/night/dana-briefing.tsx) mở một kết nối cho lựa chọn đã được chấp nhận và nhận cả thay đổi engine trên cùng socket text. [`connectDana`](../apps/web/app/night/dana-connection.ts) dùng `danaUrl`, message và sample rates từ [contract chung](../packages/contracts/dana.ts). Voice lấy PCM16 mono 16 kHz từ [worklet](../apps/web/public/dana-mic.js) và xếp phát PCM16 24 kHz theo thứ tự. Nói hoặc gửi text trong voice đều dừng audio đã xếp. Khi nhận `call_ended`, mic dừng ngay và kết nối chờ `AudioBufferSourceNode.onended` của nguồn cuối trước khi giải phóng audio rồi báo UI. Nếu audio bị tạm dừng, **Resume audio** tiếp tục queue. Dashboard giữ câu cuối của Dana để người đọc text vẫn thấy.

WebSocket chỉ truyền voice và text vì đó là contract hiện có. HTTP polling dùng lại endpoint state đã có và giúp test từng request. Nếu backend phát event có revision theo incident, subscription có thể giảm độ trễ và số lần đọc khi không có thay đổi.

## B. Dữ liệu và thuật toán

Trong `CheckoutLogs`, `n` là số log đang có, `L` là độ dài lớn nhất của một log đã ghép summary và detail, `q` là độ dài chuỗi tìm kiếm. Không có bước lập chỉ mục. Mỗi lần đổi filter, một lần scan `n` log lọc severity trước, rồi so chuỗi ở những log còn lại. Với so chuỗi đơn giản, cận trên là `O(n × L × max(1, q))`, với tối đa `O(n)` tham chiếu kết quả và một chuỗi tạm dài `O(L)` mỗi lần so. Chẳng hạn severity Error và query `tier` giữ lại hai stack trace guest checkout trong fixture. Với vài log, scan giúp tránh việc đồng bộ chỉ mục. Khi stream có nhiều trang, pagination và filter phía API giảm lượng dữ liệu trình duyệt phải giữ và quét.

Với `k` nguồn audio đang chờ, `Set` theo dõi `O(k)` tham chiếu và xóa một nguồn đã phát trong thời gian trung bình `O(1)`. Ngắt lời dừng cả hàng đợi trong `O(k)`. Một timer theo đồng hồ tường có thể hết trước khi audio bị tạm dừng phát xong.

## C. Ranh giới và lỗi

[`fixture.ts`](../apps/web/app/night/fixture.ts) dùng giá trị nền và câu chuyện ShopNorth từ [Dana fake facts](../services/api/voice/fake_facts.json). Điểm lịch sử trong chế độ offline, log hiển thị và diff là dữ liệu mô phỏng. API mode lấy tối đa bảy mẫu gần nhất từ response thật. Cả hai chế độ giữ trục y ổn định và có bảng đọc giá trị. Không thêm hình ảnh hoặc font ngoài repo.

API demo giữ phase và dữ liệu vận hành trong FastAPI. Khi mất response, giao diện giữ state đã xác nhận gần nhất, đọc lại incident và cho retry cùng idempotency key. Nếu server trả replay, client đọc snapshot mới thay vì hiển thị response đã cache lúc hành động bắt đầu. Nếu server trả 409, client đọc lại quyền thao tác. Poll và POST được tuần tự hóa vì contract chưa có revision.

Relay dùng incident, level và demo user từ API theo [đặc tả Dana](../packages/contracts/dana-voice.md). Client tái dùng capture, playback và barge-in của [reference client](../services/api/voice/dev_page.html). Khi voice chuyển sang relay text, transcript và draft được giữ. Relay text ghi rõ Deepgram hoặc scripted, còn fixture được chọn riêng khi offline hoặc khi relay lỗi. Caption log tự theo câu mới khi người chơi đang ở cuối.

### Chờ xác minh với API thật

- Demo có một incident dùng chung và state trong bộ nhớ. Refresh lấy lại state từ demo API. Join, session theo vai trò, xác thực production, revision của backend và feed thật cho logs/deploy còn là phần hợp đồng chưa có. Release target hiển thị theo scenario ShopNorth hiện tại. [Backend demo scope](../services/api/README.md)
- Relay scripted đọc `/facts` từ FastAPI cục bộ. Luan cần xác minh voice, typed chat qua Deepgram và chất lượng với mic thật trên máy demo.
- Checkpoint 03 xử lý Help và nudge. Review trước đó quan sát relay tăng `hint_calls` hai lần nếu một Help voice phải mở lại bằng text. Duy và Luan cần gộp fallback vào cùng một lượt Help trước khi frontend nối Help. Checkpoint 04B nối debrief sau khi backend xác nhận deploy fix.

## Kiểm chứng

| Lệnh hoặc thao tác | Kết quả |
| --- | --- |
| `npm run build` và `npm run typecheck` từ `apps/web` | PASS với Node 24.22.1 và npm 11.9.0. |
| `CHROMIUM_EXECUTABLE_PATH=<chromium> npm run test:browser -- tests/night.spec.ts` | 6/6 PASS với Chromium 153. Fixture kiểm rollback, keyboard và touch. Mock relay kiểm engine switch, cuộn captions, mic denial, giữ draft khi fallback, frame PCM, ngắt lời và drain sau khi resume audio. |
| `NIGHT_TEST_API_ORIGIN=http://127.0.0.1:3213 CHROMIUM_EXECUTABLE_PATH=<chromium> npm run test:browser -- tests/night-api.spec.ts` | 1/1 PASS qua FastAPI cục bộ và mock WebSocket. Relay bắt đầu sau Answer, tự vào dashboard và giữ rollback idempotent khi mất response. |
| Chromium với FastAPI và relay thật chạy local, không có Deepgram key | 3/3 PASS cho text, mic denied và server fallback voice → text. Cả ba hiện engine scripted, trả lời từ `/facts`, rồi vào dashboard sau `On it`. |
| `python -m voice.test_offline` và `python tests/test_smoke.py` từ `services/api` | 9/9 offline relay checks và 31/31 backend smoke checks PASS. |
| `git diff --cached --check` | PASS. |

Xem [lệnh chạy](../apps/web/README.md), [fixture browser smoke](../apps/web/tests/night.spec.ts) và [API browser smoke](../apps/web/tests/night-api.spec.ts). Trong môi trường kiểm thử, trình tải Chromium của Playwright trả file zip không hợp lệ, nên dùng Chromium từ gói `@sparticuz/chromium` qua executable path. Gói này chỉ phục vụ kiểm tra cục bộ.

**Tung tự giải thích:** Vì sao nhận `call_ended` chưa đủ để đóng màn hình nếu Dana còn audio trong queue?

**Kiểm tra nhanh:** Chạy API và Next theo [lệnh chạy](../apps/web/README.md). Trả lời bằng text, gửi **On it** và kiểm tra UI tự vào dashboard sau lời chào cuối. Lặp lại bằng voice và thử từ chối mic để kiểm tra nhãn relay text.
