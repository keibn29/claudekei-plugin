[🇬🇧 English](README.md)

# claudekei

**Plugin điều phối agent cho Claude Code** · bản port của [oh-my-openkei](https://www.npmjs.com/package/oh-my-openkei) (OpenCode)

by **Kei**

---

## Plugin này làm gì

Plugin Claude Code (tên plugin: `claudekei`) biến luồng hội thoại chính thành **Orchestrator**:
chia việc cho một đội subagent chuyên trách, và ghi nhớ session của từng subagent dưới alias
ngắn (`exp-1`, `ora-1`, `fed-2`) để các câu hỏi tiếp theo được xử lý tiếp trong cùng context
thay vì bắt đầu lại từ đầu, giống cơ chế `task_id` bên OpenCode.

| Thành phần | Cách hoạt động trong Claude Code |
|---|---|
| Orchestrator là agent chính | `settings.json` → `"agent": "orchestrator"` |
| Các specialist | Subagent trong `agents/*.md`, gọi bằng `claudekei:<tên>` qua tool `Agent` |
| Tái sử dụng session | `SendMessage` (resume gốc của Claude Code) + hook ánh xạ alias → agent id |
| Skill riêng cho từng agent | Frontmatter `skills:` (nạp sẵn, không cần bước "load skill trước") |
| Quyền MCP theo agent | Allowlist `tools:` (`mcp__plugin_claudekei_context7__*`, …) |
| Planner / Sprinter / Business Analyst | `claude --agent claudekei:<tên>` hoặc `/claudekei:plan`, `/claudekei:sprint`, `/claudekei:analyze` ngay trong hội thoại |
| Nhắc workflow | Hook `UserPromptSubmit` / `PostToolUse` |

## Cài đặt

Yêu cầu: Claude Code ≥ 2.1, Node.js ≥ 18 (hook chạy bằng `node`).

```bash
claude plugin marketplace add keibn29/claudekei
```

```bash
claude plugin install claudekei@claudekei
```

Hoặc trong Claude Code: `/plugin marketplace add keibn29/claudekei`, rồi
`/plugin install claudekei@claudekei`.

Cập nhật lên bản mới nhất:

```bash
claude plugin marketplace update claudekei
```

```bash
claude plugin update claudekei@claudekei
```

Muốn dùng bản clone ở máy thì thêm thư mục: `claude plugin marketplace add ~/Projects/claudekei`.

Chạy thử không cần cài:

```bash
claude --plugin-dir ~/Projects/claudekei
```

Kiểm tra: mở session và gõ `ping all agents`, orchestrator sẽ gọi lần lượt từng specialist.

> Plugin đặt **Orchestrator làm agent chính mặc định** ở mọi nơi nó được bật. Muốn dùng
> Claude bình thường trong một project, tắt plugin ở đó:
> `.claude/settings.json` → `{"enabledPlugins": {"claudekei@claudekei": false}}`.

## Đội agent

### Agent chính (agent bạn trò chuyện trực tiếp)

| Agent | Khởi động | Vai trò |
|---|---|---|
| **orchestrator** (mặc định) | `claude` / `/claudekei:orchestrate` | Điều phối, ưu tiên ủy quyền: chia việc, chạy song song, reuse session, tổng hợp và kiểm tra |
| **planner** | `claude --agent claudekei:planner` / `/claudekei:plan` | Lập kế hoạch qua phỏng vấn; chỉ ủy quyền cho explorer/librarian/oracle/designer; trả về `<planner-plan>` |
| **sprinter** | `claude --agent claudekei:sprinter` / `/claudekei:sprint` | Tự làm nhanh, không ủy quyền |
| **business-analyst** | `claude --agent claudekei:business-analyst` / `/claudekei:analyze` | Nghiên cứu, viết yêu cầu, chiến lược; lưu phân tích vào `.business-analyst/*.md` |

`/claudekei:<chế độ>` đổi vai trò ngay trong hội thoại hiện tại (tiện khi dùng app desktop).
`--agent` khởi động session với prompt và giới hạn tool riêng của agent đó.

Muốn chọn agent cho **session mới** mà không dùng CLI (ví dụ trong app desktop), gõ
`/claudekei:agent planner` (hoặc `orchestrator`, `sprinter`, `business-analyst`, `reset`;
không kèm tên thì xem giá trị hiện tại). Hook lưu vào `.claude/settings.local.json` của
project mà không tốn lượt model; sau đó mở session mới (Cmd+N).

### Specialist (`subagent_type: claudekei:<tên>`)

| Agent | Model mặc định | Quyền | Vai trò |
|---|---|---|---|
| explorer | haiku | chỉ đọc (+ Serena nếu cấu hình) | Tìm file, symbol, pattern |
| librarian | haiku | chỉ đọc + WebFetch/WebSearch + context7, grep_app, websearch (+ Atlassian) | Tra tài liệu thư viện, API, ví dụ GitHub |
| oracle | opus, effort high | chỉ đọc, skill `simplify` | Kiến trúc, trade-off, review code, bug khó |
| debugger | sonnet, effort high | chỉ đọc | Tìm nguyên nhân gốc, không sửa |
| designer | sonnet | đầy đủ (không gọi subagent) | Quyết định UI/UX |
| frontend-developer | sonnet | đầy đủ (không gọi subagent), skill `vercel-react-best-practices`, `karpathy-guidelines` | Code phía client + test |
| backend-developer | sonnet | đầy đủ (không gọi subagent), skill `backend-developer`, `karpathy-guidelines` | Code phía server + test |
| trigger-developer | sonnet | đầy đủ (không gọi subagent), skill `karpathy-guidelines` | Trigger.dev |
| observer | haiku | Read/Glob | Đọc ảnh, screenshot, PDF → text có cấu trúc |

Model của luồng chính là model bạn chọn trong Claude Code (`/model`); nên dùng Opus cho
orchestrator và planner.

Đổi model/effort của specialist mà không cần sửa plugin: tạo `~/.claude/claudekei.jsonc`
(hoặc `<project>/.claude/claudekei.jsonc`), định dạng giống `oh-my-openkei.jsonc`:

```jsonc
{
  "preset": "default",
  "presets": {
    "default": {
      "oracle": { "model": "opus", "variant": "xhigh" },
      "explorer": { "model": "haiku" },
    },
  },
}
```

Specialist có hiệu lực ngay ở lần giao việc tiếp theo; agent chính (`orchestrator`, `planner`…)
nhận `model`/`effort` làm mặc định cho session mới khi bạn chạy `/claudekei:agent <tên>`. Chi tiết: [docs/configuration.md](docs/configuration.md#config-file-claudekeijsonc).

## Tái sử dụng session

```text
### Resumable Sessions
- explorer: exp-1 Find PHASE_REMINDER_TEXT usage
  Context read by exp-1: src/config/constants.ts (30 lines), src/hooks/phase-reminder/index.ts (95 lines)
- oracle: ora-1 Review auth architecture
```

- Mỗi lần luồng chính gọi `Agent`, subagent đó được gán một alias và model được báo ngay.
- Cùng chủ đề → `SendMessage` với `to: "exp-1"`; hook đổi alias thành agent id thật.
  Chủ đề mới → gọi `Agent` mới.
- Alias không tồn tại hoặc đã bị loại bị chặn trước khi chạy, kèm danh sách alias hợp lệ.

Chi tiết: **[docs/session-management.md](docs/session-management.md)**.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [Session Management](docs/session-management.md) | Alias, cơ chế loại bỏ, read context, giới hạn |
| [Configuration](docs/configuration.md) | Model, biến môi trường, MCP, skill, tùy chỉnh agent |
| [Chuyển từ oh-my-openkei](docs/migration-from-opencode.md) | Phần chuyển 1:1, phần thay đổi, phần bỏ đi |

## Phát triển

```bash
npm test                # test hook (node:test)
npm run sync:modes      # tạo lại skill /claudekei:* từ agents/*.md
npm run check           # kiểm tra sync + test + claude plugin validate
```

## License

MIT
