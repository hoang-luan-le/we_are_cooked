STATUS: READY_FOR_REVIEW
COMMAND_ID: 01-NIGHT-2D-01

# Night 2D handoff

Nhánh `branch-codex` dùng [`main` tại `004770e`](https://github.com/thanhtungnguyen-dev/we_are_cooked/tree/004770ea5a935f27e3bbb035df46aeb3608e78e6) làm nền. Backend incident engine vào `main` trong khi làm task, nên nhánh đã đồng bộ và dùng [contract mới](../packages/contracts/types.ts). Theo [lệnh giao việc đã cập nhật](https://github.com/thanhtungnguyen-dev/we_are_cooked/issues/1#issuecomment-6717573246), Sol gửi slice này cho Tung duyệt.

## A. Full-stack và React

- [`Home`](../apps/web/app/page.tsx) đưa người dùng vào [`NightPage`](../apps/web/app/night/page.tsx). Route mở demo trong development hoặc khi người vận hành bật `NIGHT_FIXTURES=1` trên bản build. Origin loopback đã cấu hình chọn **Local demo API**, còn `?fixture=1` chọn **Development fixture**. Bản build mặc định hiển thị trạng thái unavailable. [`next.config.mjs`](../apps/web/next.config.mjs) đặt root ở monorepo để dùng trực tiếp các contract TypeScript. [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation) · [Turbopack root](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory)
- [`NightRun`](../apps/web/app/night/night-run.tsx) giữ ba bước page, briefing và board. Ở chế độ API, **Answer Dana** đợi `answer` được chấp nhận rồi mở briefing. Micro chỉ được yêu cầu khi người dùng chọn **Use relay voice**. Effect theo `visibleStage` chuyển focus sau khi heading mới được render. Effect theo `visibleStage` và `snoozed` đặt lại Snooze sau 5 giây và hủy timer khi đổi bước hoặc rời route.
- [`useNightApi`](../apps/web/app/night/use-night-api.ts) đồng bộ với backend qua [`/api/night`](../apps/web/app/api/night/route.ts). Effect theo `enabled` và `read` bắt đầu đọc state mỗi 2 giây rồi dọn interval và hủy request khi rời route. User action hủy poll đang chờ, gửi `ActionRequest` qua proxy cùng origin, nhận `ActionResponse`, rồi cập nhật snapshot. Proxy chỉ gửi action được hỗ trợ đến `inc_demo` ở loopback, với demo user cấu hình phía server.
- [`IncidentBoard`](../apps/web/app/night/incident-board.tsx) lấy quyền mở panel và rollback từ state API. Dialog xác nhận target `v2.13.9`. API mode chờ `phase`, metrics và `loyalty_discounts` từ backend để hiển thị kết quả. Trong fixture, confirm đặt `step=0` và effect theo `step` lên lịch đúng một mẫu tiếp theo. Effect hủy timer khi step đổi hoặc component unmount.
- [`DanaBriefing`](../apps/web/app/night/dana-briefing.tsx) mở WebSocket theo lựa chọn của người dùng. [`connectDana`](../apps/web/app/night/dana-connection.ts) dùng `danaUrl`, loại message và sample rates từ [contract chung](../packages/contracts/dana.ts). Relay gửi `ready`, `caption` và `status` để cập nhật UI. Text gửi message `{ type: "text", text }`. Voice chuyển PCM16 mono 16 kHz từ [worklet](../apps/web/public/dana-mic.js) và xếp phát PCM16 24 kHz theo thứ tự. Khi unmount, effect cleanup gọi `close` trên kết nối hiện tại để gửi hang-up, dừng track, dọn audio và đóng socket.

WebSocket chỉ truyền voice và text vì đó là contract hiện có. HTTP polling dùng lại endpoint state đã có và giúp test từng request. Nếu backend phát event có revision theo incident, subscription có thể giảm độ trễ và số lần đọc khi không có thay đổi.

## B. Dữ liệu và thuật toán

Trong `CheckoutLogs`, `n` là số log đang có, `L` là độ dài lớn nhất của một log đã ghép summary và detail, `q` là độ dài chuỗi tìm kiếm. Không có bước lập chỉ mục. Mỗi lần đổi filter, một lần scan `n` log lọc severity trước, rồi so chuỗi ở những log còn lại. Với so chuỗi đơn giản, cận trên là `O(n × L × max(1, q))`, với tối đa `O(n)` tham chiếu kết quả và một chuỗi tạm dài `O(L)` mỗi lần so. Chẳng hạn severity Error và query `tier` giữ lại hai stack trace guest checkout trong fixture. Với vài log, scan giúp tránh việc đồng bộ chỉ mục. Khi stream có nhiều trang, pagination và filter phía API giảm lượng dữ liệu trình duyệt phải giữ và quét.

## C. Ranh giới và lỗi

[`fixture.ts`](../apps/web/app/night/fixture.ts) dùng giá trị nền và câu chuyện ShopNorth từ [Dana fake facts](../services/api/voice/fake_facts.json). Điểm lịch sử trong chế độ offline, log hiển thị và diff là dữ liệu mô phỏng. API mode lấy tối đa bảy mẫu gần nhất từ response thật. Cả hai chế độ giữ trục y ổn định và có bảng đọc giá trị. Không thêm hình ảnh hoặc font ngoài repo.

API demo giữ phase và dữ liệu vận hành trong FastAPI. Khi mất response, giao diện giữ state đã xác nhận gần nhất, đọc lại incident và cho retry cùng idempotency key. Nếu server trả replay, client đọc snapshot mới thay vì hiển thị response đã cache lúc hành động bắt đầu. Nếu server trả 409, client đọc lại quyền thao tác. Poll và POST được tuần tự hóa vì contract chưa có revision.

Briefing mặc định là scripted text. Relay tùy chọn dùng incident, level và demo user của API nếu có, theo [đặc tả Dana](../packages/contracts/dana-voice.md). Client tái dùng cách capture, playback và barge-in của [reference client](../services/api/voice/dev_page.html). Nếu mic bị từ chối hoặc voice relay báo lỗi có fallback, client chuyển sang text. Nếu text relay cũng lỗi, vẫn có thể dùng scripted briefing hoặc vào board.

### Chờ xác minh với API thật

- Demo có một incident dùng chung và state trong bộ nhớ. Refresh lấy lại state từ demo API. Join, session theo vai trò, xác thực production, revision của backend và feed thật cho logs/deploy còn là phần hợp đồng chưa có. Release target hiển thị theo scenario ShopNorth hiện tại. [Backend demo scope](../services/api/README.md)
- Luan cần xác minh relay với cấu hình nhà cung cấp thật và quyền đọc `/facts`. Browser kiểm giao thức bằng mock socket và dùng audio tổng hợp để kiểm frame. Chất lượng âm thanh và kết quả Gemini/Deepgram cần test cùng dịch vụ.

## Kiểm chứng

| Lệnh hoặc thao tác | Kết quả |
| --- | --- |
| `npm run build` và `npm run typecheck` từ `apps/web` | PASS với Node 24.22.1 và npm 11.9.0. |
| `CHROMIUM_EXECUTABLE_PATH=<chromium> npm run test:browser -- tests/night.spec.ts` | 5/5 PASS với Chromium 153. Fixture đi từ landing đến recovery, kiểm keyboard, Snooze, touch ở 360 px, log rỗng và cancel rollback. Mock relay kiểm captions, text, hang-up, mic denied, relay lỗi, frame PCM 3.200 byte từ audio tổng hợp và dọn track. |
| `NIGHT_TEST_API_ORIGIN=http://127.0.0.1:3213 CHROMIUM_EXECUTABLE_PATH=<chromium> npm run test:browser -- tests/night-api.spec.ts` | 1/1 PASS qua FastAPI thật chạy cục bộ. Answer và ba panel được ghi nhận. Test làm mất response rollback, đợi state API báo ổn định, retry cùng key và xác nhận chỉ có một rollback. Sau reload, UI giữ recovery với 0.4%, 420 đơn/phút và discounts Off. |
| Mở `/night` và `/api/night` với `next start` khi thiếu `NIGHT_FIXTURES` | PASS. Trang hiện trạng thái unavailable và proxy trả 404 dù có origin loopback. |
| `python tests/test_smoke.py` từ `services/api` | 31/31 PASS trên backend tại commit nền. |
| Xem dashboard qua ảnh Chromium ở 1300 và 360 px | Metrics, trạng thái và nội dung log đều đọc được, không tràn ngang. |
| `git diff --cached --check` | PASS. |

Xem [lệnh chạy](../apps/web/README.md), [fixture browser smoke](../apps/web/tests/night.spec.ts) và [API browser smoke](../apps/web/tests/night-api.spec.ts). Trong môi trường kiểm thử, trình tải Chromium của Playwright trả file zip không hợp lệ, nên dùng Chromium từ gói `@sparticuz/chromium` qua executable path. Gói này chỉ phục vụ kiểm tra cục bộ.

**Tung tự giải thích:** Nếu mất response sau khi rollback thành công, vì sao retry dùng cùng key rồi đọc lại state?

**Kiểm tra nhanh:** Chạy `cd apps/web && npm ci && npm run dev`. Mở **Start Night 2D**, trả lời Dana, lọc log Error, xem diff, rồi rollback. Xem mẫu cuối trong **Read chart values** và kiểm tra **Loyalty discounts** chuyển thành Off.
