# 工具参考

Telegram MCP Server 提供按类别组织的 194 个工具。所有工具通过 MCP 自动发现。

## 认证

| 工具 | 说明 |
| ------ | ------ |
| `telegram-status` | 检查连接状态和账户信息 |
| `telegram-login` | 生成认证二维码 |
| `telegram-logout` | 撤销 Telegram 服务器上的会话并删除本地会话文件 |

## 消息

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-message` | 发送消息到任何聊天（支持 `quoteText` 引用原消息片段，以及 Premium `effect` 动画特效） |
| `telegram-edit-message` | 编辑已发送的消息 |
| `telegram-delete-message` | 删除消息 |
| `telegram-forward-message` | 转发消息 |
| `telegram-send-scheduled` | 定时发送消息 |
| `telegram-send-typing` | 发送"正在输入"/上传操作指示 |
| `telegram-translate-message` | 翻译一条或多条消息（需 Premium；会消耗翻译配额） |
| `telegram-get-message-link` | 获取消息的公开 t.me 链接 |

## 原生 Rich Messages（本地扩展）

以下七个工具使用个人账号发送 Telegram 原生富文本块，包括真正的表格。普通消息的 `parseMode: "md"` 用于文本格式；原生表格需要 rich 工具。

| 工具 | 描述 |
|------|-------------|
| `telegram-preview-rich-message` | 本地编译 `markdown`，检查文本、表头/单元格和限制；不连接或发送 |
| `telegram-rich-message-capabilities` | 查询协议层、账号 Premium 和服务器 `rich_message_posting` 模式 |
| `telegram-send-rich-message` | 使用持久 UUID v4 `requestId` 发送原生富文本 |
| `telegram-edit-rich-message` | 按精确 `chatId` / `messageId` 替换富文本内容 |
| `telegram-save-rich-draft` | 保存原生富文本草稿，可指定回复/话题 |
| `telegram-get-rich-message` | 读取指定消息的文本和表格，明确标注部分/不支持的内容 |
| `telegram-get-rich-send-status` | 按 `requestId` 读取本地持久回执；不发送或重试 |

先预览并查询能力。发送取决于服务器资格（通常需要 Premium）和聊天权限；安装成功并不证明可发送。编译器支持表格、标题、段落、平面列表/任务列表、引用、围栏代码、链接和行内样式；拒绝嵌套列表、脚注、数学表达式等不支持的语法。本地限制为 128 KiB UTF-8 源码、32,768 个渲染字符、500 个块、16 层嵌套及每表 20 列。服务器还会执行自身限制。不会自动改发普通文本。

写入需要 `chatId`、`markdown` 和新的 UUID v4 `requestId`；编辑还需要 `messageId`。相同 ID 和相同负载返回已有回执；更改聊天、操作、内容或选项会被拒绝。回执保存在会话文件旁的 `rich-message-operations` 目录中。遇到 `submitting` 或 `uncertain`，应查询状态并读取精确消息/历史；不要删除回执或换新 ID 盲目重发。即时发送/编辑被接受后，会按精确 peer/ID 回读；`verified` 表示完整且受支持的文本、表格、显式链接、样式和规范化原生结构一致。读取还返回有界的 `semanticStructure` 以及 `semanticUnsupported` 诊断。定时发送仅保留确认 ID，不宣称已送达或立即验证。草稿只确认保存，不回读消息。发送选项有 `silent`、`protectContent`、`clearDraft`、`replyTo`、`topicId`、`scheduleDate`、`rtl`、`noautolink`；编辑支持后两项，草稿还支持回复/话题。

## 精确读取与 API 目录（本地扩展）

| 工具 | 描述 |
|------|-------------|
| `telegram-get-messages-by-id` | 按输入顺序读取同一聊天中 1–100 个不同 ID，并标注缺失/不可访问的 ID |
| `telegram-get-history-page` | 从新到旧读取一页，支持 `offsetId`、`offsetDate`、有符号 `addOffset`、`minId`、`maxId`、`limit` |
| `telegram-search-sent-media` | 跨聊天搜索近期发出的媒体，最多 100 条，不支持分页 |
| `telegram-api-search` | 按名称、结果类型或字段检索已安装的 TL 方法/类型，支持有界分页 |
| `telegram-api-describe` | 查看一个 TL 方法/构造器的字段、类型、可选标志位及返回类型 |

这些读取不会标记消息已读。账号全局消息 ID 会按已解析的聊天过滤。历史 ID 边界不包含端点；`nextOffsetId` 为最后一条原生记录的 ID，只有空页才能确认结束。使用该游标继续时请重置 `addOffset`。媒体过滤器为 `photo`、`video`、`photoVideo`、`document`、`music`、`voice`、`gif`；服务器可能拒绝不支持的过滤器。输出文本有长度限制，不是完整导出。

目录离线读取已安装的第 233 层协议，包含尚无专用 MCP 工具的字段。检索和描述**不能执行**任意 API，也不会授予权限。字段名采用 GramJS camelCase；标志指示字段由序列化器管理。

## 普通文本格式与发送参数

`telegram-send-message`、`telegram-edit-message`、`telegram-save-draft` 支持 `entities`、`noWebpage`、`invertMedia`；编辑/草稿也支持 `parseMode`。实体包含 `type`、`offset`、`length`，`text_url` 可带 `url`，`pre` 可带 `language`。类型包括 `bold`、`italic`、`underline`、`strike`、`spoiler`、`code`、`pre`、`text_url`。范围按未解析文本的 UTF-16 代码单元计算，不能拆分代理对；最多 100 个实体。`entities` 与 `parseMode` 互斥。链接协议仅允许 http、https、mailto、tg。

发送还支持 `silent`、`background`、`clearDraft`、`protectContent`（MTProto `noforwards`）、`scheduleDate`、`scheduleRepeatPeriod`、`sendAs`、`replyToPeer`、`quoteOffset`，以及 `quoteText`、`effect`、`replyTo`、`topicId`。时间使用未来 Unix 秒数；重复发送需要 `scheduleDate`。`replyToPeer` 需要 `replyTo`；`quoteOffset` 需要 `quoteText` 和 `replyTo`。权限、Premium 特效和重复定时资格由服务器决定。普通写入不提供持久 rich `requestId` 回执。

## 定时消息

| 工具 | 说明 |
|------|------|
| `telegram-get-scheduled` | 列出聊天中的定时消息 |
| `telegram-delete-scheduled` | 删除一条或多条定时消息 |

## 阅读

| 工具 | 说明 |
| ------ | ------ |
| `telegram-list-chats` | 列出聊天（支持过滤） |
| `telegram-read-messages` | 读取最近消息（支持分页） |
| `telegram-search-messages` | 在特定聊天中搜索 |
| `telegram-search-global` | 跨所有聊天搜索 |
| `telegram-search-chats` | 按名称搜索聊天 |
| `telegram-get-unread` | 获取有未读消息的聊天 |
| `telegram-mark-as-read` | 标记为已读 |
| `telegram-get-replies` | 读取频道帖子下的评论/回复 |
| `telegram-get-unread-mentions` | 列出聊天中未读的 @ 提及（会在服务端标为已读） |
| `telegram-get-unread-reactions` | 列出你消息上未读的回应（会在服务端标为已读） |
| `telegram-get-saved-dialogs` | 列出"收藏消息"内的分类文件夹 |

## 草稿

| 工具 | 说明 |
| ------ | ------ |
| `telegram-save-draft` | 在聊天中保存文本草稿（为空则删除） |
| `telegram-get-drafts` | 列出所有含草稿的聊天 |
| `telegram-clear-drafts` | 清除单个聊天的草稿，或全账号清除（需 `confirmAllChats: true`） |

## 论坛话题

| 工具 | 说明 |
| ------ | ------ |
| `telegram-list-topics` | 列出论坛话题 |
| `telegram-read-topic-messages` | 读取特定话题的消息 |
| `telegram-create-topic` | 新建话题 |
| `telegram-edit-topic` | 重命名、关闭、隐藏或更新话题 |
| `telegram-delete-topic` | 删除话题及其历史 |

## 投票

| 工具 | 说明 |
|------|------|
| `telegram-create-poll` | 创建投票或测验 |

## 投票互动 (v1.31.0)

| 工具 | 说明 |
| ------ | ------ |
| `telegram-vote-poll` | 按选项索引投票，`optionIndexes: []` 撤回投票 |
| `telegram-get-poll-results` | 获取投票汇总结果：票数、百分比、测验正确答案 |
| `telegram-get-poll-voters` | 列出投票特定选项的用户（仅限公开投票，支持分页） |
| `telegram-close-poll` | 永久关闭投票（不可逆操作） |

## 回应

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-reaction` | 给消息添加表情回应 |
| `telegram-get-reactions` | 获取消息的回应 |
| `telegram-set-default-reaction` | 设置账户默认快捷回应表情 |
| `telegram-get-top-reactions` | 获取 Telegram 热门回应表情 |
| `telegram-get-recent-reactions` | 获取最近使用过的回应表情 |

## 付费回应 (v1.31.0)

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-paid-reaction` | 向频道帖子发送 ★ 星级付费回应（`count` 1–2500，可选 `private` 参数） |
| `telegram-toggle-paid-reaction-privacy` | 切换特定帖子付费回应的排行榜可见性 |
| `telegram-get-paid-reaction-privacy` | 获取当前默认付费回应隐私设置 |

## 语音转文字 (v1.31.0)

| 工具 | 说明 |
| ------ | ------ |
| `telegram-transcribe-audio` | 对语音/视频消息进行服务端转录（Telegram Premium）。若 `pending:true` 请轮询 `telegram-get-transcription` |
| `telegram-get-transcription` | 轮询转录状态（幂等调用，完成后返回文字） |
| `telegram-rate-transcription` | 评价转录质量（好/差）以改善语音识别 |

## 事实核查 (v1.31.0)

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-fact-check` | 获取最多 100 条频道消息的事实核查注释 |
| `telegram-edit-fact-check` | 添加或更新事实核查注释（需要事实核查员权限） |
| `telegram-delete-fact-check` | 删除事实核查注释（需要事实核查员权限） |

## 贴纸

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-sticker` | 发送贴纸 |
| `telegram-get-installed-stickers` | 已安装的贴纸包列表 |
| `telegram-get-recent-stickers` | 最近使用的贴纸 |
| `telegram-get-sticker-set` | 浏览贴纸包 |
| `telegram-search-sticker-sets` | 搜索贴纸包 |

## 媒体

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-file` | 发送文件、图片或文档 |
| `telegram-download-media` | 下载消息中的媒体 |
| `telegram-get-profile-photo` | 获取头像 |
| `telegram-get-web-preview` | 发送前预览链接的标题/描述/站点 |

## 富媒体发送 (v1.29.0)

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-voice` | 发送语音消息（推荐 OGG/Opus），显示为波形 UI |
| `telegram-send-video-note` | 发送圆形视频消息（MP4，建议正方形，≤60 秒） |
| `telegram-send-location` | 发送地理位置；设置 `livePeriod`（60–86400 秒）以发送实时位置 |
| `telegram-send-venue` | 发送场所卡片（标题、地址、经纬度） |
| `telegram-send-contact` | 发送联系人卡片（手机号、姓名、可选 vCard） |
| `telegram-send-dice` | 发送动画骰子/游戏表情（🎲🎯🎰🏀⚽🎳），返回服务器判定的点数 |
| `telegram-send-album` | 发送 2–10 张图片/视频组成的相册 |

所有 `filePath` 必须为绝对本地文件路径。URL、UNC 共享、路径穿越（`..`）以及 POSIX 伪文件系统（`/proc`、`/sys`、`/dev`、`/run`）将被拒绝。

## 群组

| 工具 | 说明 |
| ------ | ------ |
| `telegram-create-group` | 创建群组 |
| `telegram-edit-group` | 编辑标题、描述、头像 |
| `telegram-invite-to-group` | 邀请用户 |
| `telegram-join-chat` | 通过邀请链接加入 |
| `telegram-leave-group` | 离开群组 |
| `telegram-kick-user` | 踢出用户 |
| `telegram-ban-user` | 封禁用户 |
| `telegram-unban-user` | 解除封禁 |
| `telegram-set-admin` | 设为管理员 |
| `telegram-remove-admin` | 撤销管理员 |
| `telegram-get-my-role` | 查看自己的角色和权限 |
| `telegram-set-chat-permissions` | 为所有成员设置默认权限（未指定的标志保留当前值） |
| `telegram-set-slow-mode` | 为超级群组设置慢速模式间隔 |
| `telegram-get-admin-log` | 查看管理员/审核事件日志 |

## 聊天信息

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-chat-info` | 获取聊天详情 |
| `telegram-get-chat-members` | 列出群组/频道成员 |
| `telegram-get-chat-folders` | 列出聊天文件夹 |

## 邀请链接

| 工具 | 说明 |
| ------ | ------ |
| `telegram-create-invite-link` | 创建邀请链接 |
| `telegram-get-invite-links` | 列出现有链接 |
| `telegram-revoke-invite-link` | 撤销链接 |

## 联系人

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-contacts` | 联系人列表 |
| `telegram-add-contact` | 添加联系人 |
| `telegram-get-contact-requests` | 查看待处理的联系请求 |

## 审核

| 工具 | 说明 |
| ------ | ------ |
| `telegram-block-user` | 屏蔽用户 |
| `telegram-unblock-user` | 取消屏蔽 |
| `telegram-report-spam` | 举报垃圾信息 |

## 个人资料

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-profile` | 获取用户资料 |
| `telegram-get-saved-music` | 列出用户资料中置顶的歌曲 |
| `telegram-update-profile` | 更新自己的资料（姓名、简介、用户名） |

## 账户

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-sessions` | 列出活跃会话（设备） |
| `telegram-terminate-session` | 终止会话 |
| `telegram-set-privacy` | 配置隐私设置 |
| `telegram-set-auto-delete` | 设置消息自动删除计时器 |

## 置顶

| 工具 | 说明 |
|------|------|
| `telegram-pin-message` | 置顶消息 |
| `telegram-unpin-message` | 取消置顶 |

## 聊天设置

| 工具 | 说明 |
| ------ | ------ |
| `telegram-mute-chat` | 静音或取消静音通知 |
| `telegram-archive-chat` | 将会话移入/移出"归档"文件夹 |
| `telegram-pin-chat` | 在会话列表中置顶/取消置顶 |
| `telegram-mark-dialog-unread` | 将会话标记为未读或清除未读标记 |

## 管理员开关与定制

| 工具 | 说明 |
| ------ | ------ |
| `telegram-toggle-channel-signatures` | 切换频道帖子的签名 |
| `telegram-toggle-anti-spam` | 切换超级群组内置反垃圾（需 `ban_users` 权限） |
| `telegram-toggle-forum-mode` | 启用/禁用论坛模式（禁用会删除所有主题；需要 `confirm: true`） |
| `telegram-toggle-prehistory-hidden` | 对新加入的超级群成员隐藏或显示历史消息 |
| `telegram-set-chat-reactions` | 配置会话允许的表情回应（`all` / `some` / `none`） |
| `telegram-approve-join-request` | 批准或拒绝加入请求 |

## 统计

| 工具 | 说明 |
|------|------|
| `telegram-get-broadcast-stats` | 获取频道统计（`includeGraphs: true` 返回原始图表数据；可能需要 Premium 管理员） |
| `telegram-get-megagroup-stats` | 获取超级群统计（Telegram 限制每个频道约 30 分钟 1 次） |

## 内联机器人与按钮

| 工具 | 说明 |
| ------ | ------ |
| `telegram-inline-query` | 在会话上下文中向内联机器人发起查询（queryId 有效期 ≈ 1 分钟） |
| `telegram-inline-query-send` | 根据 queryId + 结果 id 发送内联机器人结果 |
| `telegram-press-button` | 按 row/col 或原始 data 点击消息的回调按钮 |
| `telegram-get-message-buttons` | 列出消息 reply-markup 的按钮、索引和类型 |

## 实时更新（轮询）

游标由客户端保存——Agent 在多次调用之间自行维护 `{pts, qts, date}`。

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-state` | 初始化轮询游标（`pts`, `qts`, `date`, `seq`） |
| `telegram-get-updates` | 根据已知游标获取全局更新（`DifferenceTooLong` 时返回历史回退提示） |
| `telegram-get-channel-updates` | 按频道游标获取该频道的更新 |

## 故事（Stories）

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-all-stories` | 跨联系人列出故事并返回分页状态 |
| `telegram-get-peer-stories` | 列出单个 peer 发布的故事 |
| `telegram-get-stories-by-id` | 按 id 获取特定故事 |
| `telegram-get-story-views` | 列出自己故事的查看记录（完整统计需 Premium） |

## 故事写入（v1.30.0）

| 工具 | 说明 |
| ------ | ------ |
| `telegram-send-story` | 发布照片或视频故事，支持隐私控制、时长和防转发标志 |
| `telegram-edit-story` | 编辑故事：替换媒体、更新说明或更改隐私设置 |
| `telegram-delete-stories` | 删除一个或多个故事（不可撤销；需 `confirm: true`） |
| `telegram-react-to-story` | 对故事添加表情反应；传 `""` 取消反应 |
| `telegram-export-story-link` | 获取公开故事的 `t.me/…` 分享链接 |
| `telegram-read-stories` | 将故事标记为已查看（直到指定 ID） |
| `telegram-toggle-story-pinned` | 在个人资料中置顶/取消置顶故事 |
| `telegram-toggle-story-pinned-to-top` | 将故事固定到置顶行顶部；传 `[]` 清除 |
| `telegram-activate-stealth-mode` | 隐藏故事查看记录（需要 Telegram Premium） |
| `telegram-get-stories-archive` | 分页获取已过期故事的存档 |
| `telegram-report-story` | 通过多步骤流程举报故事 |

## 讨论组（v1.30.0）

| 工具 | 说明 |
|------|------|
| `telegram-get-discussion-message` | 获取频道帖子的讨论组信息（discussionGroupId、unreadCount 等） |
| `telegram-get-groups-for-discussion` | 列出可链接为频道讨论组的群组 |

## 已读回执（v1.30.0）

| 工具 | 说明 |
|------|------|
| `telegram-get-message-read-participants` | 列出小型群组中读过某条消息的成员（≤100 人，≤7 天） |
| `telegram-get-outbox-read-date` | 获取私聊中对方阅读您发出消息的时间 |

## 个人资料写入（v1.32.0）

| 工具 | 说明 |
| ------ | ------ |
| `telegram-set-emoji-status` | 设置表情符号状态（Premium）。传 `documentId` 或 `collectibleId`；均省略则清除 |
| `telegram-list-emoji-statuses` | 列出可用状态：`default`/`recent`/`channel_default`/`collectible` |
| `telegram-clear-recent-emoji-statuses` | 清空"最近使用"表情符号状态列表 |
| `telegram-set-profile-color` | 设置姓名颜色或资料背景颜色（Premium 需 index ≥ 7） |
| `telegram-set-birthday` | 设置生日（`day`+`month`，`year` 可选）。`clear=true` 删除 |
| `telegram-set-personal-channel` | 在资料页展示频道。`clear=true` 移除 |
| `telegram-set-profile-photo` | 上传头像（JPEG/PNG 或 MP4 方形 ≤10s）。`fallback=true` 设为隐私备用头像 |
| `telegram-delete-profile-photo` | 按 ID 删除头像照片。返回 `deleted` 和 `missing` |

## Telegram Business（v1.32.0）

需要 **Telegram Business** 订阅（另有标注除外）。

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-business-chat-links` | 列出 Business 会话链接（无需 Business 订阅） |
| `telegram-create-business-chat-link` | 创建预填消息的 `t.me/m/...` 深链接 |
| `telegram-edit-business-chat-link` | 按 slug 编辑链接 |
| `telegram-delete-business-chat-link` | 按 slug 删除链接 |
| `telegram-resolve-business-chat-link` | 解析 slug，获取对应聊天和预填消息 |
| `telegram-set-business-hours` | 设置营业时间：`timezone` + `{day, openFrom, openTo}` 数组。`clear=true` 清除 |
| `telegram-set-business-location` | 设置地址 ± 坐标。`clear=true` 清除 |
| `telegram-set-business-greeting` | 新聊天自动回复。`shortcutId`、`audience`、`noActivityDays` |
| `telegram-set-business-away` | 离线自动回复。`schedule`：`always`/`outside_hours`/`custom` |
| `telegram-set-business-intro` | 新用户看到的介绍卡片：`title`+`description`+可选贴纸 |

## 助推

| 工具 | 说明 |
| ------ | ------ |
| `telegram-get-my-boosts` | 列出你当前分配的助推槽位 |
| `telegram-get-boosts-status` | 频道/超级群的助推状态 |
| `telegram-get-boosts-list` | 列出频道的助推者（管理员） |

## 聊天文件夹（v1.33.0）

| 工具 | 描述 |
| ------ | ------ |
| `telegram-create-folder` | 创建聊天文件夹——通过类型标志自动包含整个分类，或指定具体聊天 |
| `telegram-edit-folder` | 按 ID 编辑现有文件夹；未传字段保持当前值 |
| `telegram-delete-folder` | 按 ID 删除文件夹（聊天仍保留在「所有聊天」中；系统文件夹不可删除） |
| `telegram-reorder-folders` | 按新的 ID 顺序重新排列文件夹 |
| `telegram-toggle-folder-tags` | 启用/禁用文件夹标签——聊天列表中的彩色标记（Premium） |
| `telegram-get-suggested-folders` | 获取 Telegram 推荐的文件夹模板（如「未读」「个人」「工作」） |

## 全局隐私（v1.33.0）

| 工具 | 描述 |
|------|------|
| `telegram-get-global-privacy-settings` | 读取账户级隐私设置：自动归档新的非联系人、归档不静音、隐藏已读回执、仅 Premium 可私信 |
| `telegram-set-global-privacy-settings` | 更新账户级隐私设置；未传字段保持当前值（部分需要 Premium） |

## 按需启用（env 门控）

以下工具仅在对应环境变量启用时注册。

| 工具 | Env 变量 |
| ------ | --------- |
| `telegram-get-group-call` | `MCP_TELEGRAM_ENABLE_GROUP_CALLS=1` |
| `telegram-get-group-call-participants` | `MCP_TELEGRAM_ENABLE_GROUP_CALLS=1` |
| `telegram-get-stars-status` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-stars-transactions` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-stars-topup-options` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-stars-subscriptions` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-change-stars-subscription` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-available-star-gifts` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-saved-star-gifts` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-save-star-gift` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-convert-star-gift` | `MCP_TELEGRAM_ENABLE_STARS=1` |
| `telegram-get-quick-replies` | `MCP_TELEGRAM_ENABLE_QUICK_REPLIES=1` |
| `telegram-get-quick-reply-messages` | `MCP_TELEGRAM_ENABLE_QUICK_REPLIES=1` |

---

::: tip
无需记忆这些工具。用自然语言描述您的需求 — AI 助手会自动选择合适的工具。
:::
