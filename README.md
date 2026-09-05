# 外链机会助手 · Backlink Finder v2

Chrome MV3 扩展。发现博客评论外链机会 → 按任务队列拟真填充 → 跟踪每一条的发布结果。
数据源用 **GoAnyAPI Backlinks API**。零依赖、零构建，加载即用。

## 界面

侧边栏常驻（不是弹窗，切换标签页不会消失），四个工作区：

| 工作区 | 做什么 |
|---|---|
| **收集** | 输入竞品域名拉 topBacklinks，或一键收集当前页；筛选、勾选、导出 CSV、建任务 |
| **发布** | 任务队列。每张卡显示目标站、✓ 成功 / ⧗ 待审核 / ✕ 失败 / 剩余，运行中有大号统计面板 |
| **日志** | 每一条发布的时间线，可按级别过滤、导出 |
| **资源库** | 身份、评论模板（支持同义词随机）、站点选择器规则 |

页脚：设置 · 清空数据 · 中文 / English 实时切换。

## 相比 v1 的改动

**架构**
- 弹窗 + 选项页 → **侧边栏**（`chrome.sidePanel`），发布过程可以一直看着。
- 单文件 → 分层模块：`src/bg`（后台业务）、`src/content`（页面脚本）、`src/panel`（UI）、`src/shared`（纯函数）。
- 所有持久化收敛到 `src/bg/store.js` 一条**串行队列**。v1 里 content script、选项页、后台三处并发读改写同一份 `candidates`，后写的会整块覆盖先写的。

**安全**
- v1 把 API 返回的 `title` / `anchor` / `urlFrom` 直接拼进 `innerHTML`，是注入面。v2 全部走 `textContent`，并用 `safeHttpUrl()` 挡掉 `javascript:` / `data:` 链接。
- v1 在 `http(s)://*/*` 静态注入 content script，等于每个网页都跑扩展代码。v2 改成 `optional_host_permissions` + 按需 `chrome.scripting.executeScript`：只有任务真正打开的那个标签页会被注入，权限在你点击时才申请。

**发布可靠性**
- 任务化：一次跑一个任务、一条条推进，cursor 落盘，service worker 被回收后能接着跑。
- 节流：每条之间随机间隔（默认 25–70s）+ 同根域名冷却（默认 30 分钟），避免固定节奏被判 spam。
- 结果判定：读页面回执区分 **已发布 / 待审核 / 失败**；提交后整页跳转时会重新注入再读一次，不会把成功记成失败。
- 表单识别从「第一个匹配的选择器」换成**打分**（name/id 精确匹配、autocomplete、关联 label、是否在评论表单内），不会再把搜索框当评论框。识别不了的站点可以在资源库里写自定义选择器。
- 识别 Disqus / Facebook / giscus 等跨域 iframe 评论系统并直接标记为需人工，不做无效尝试。
- API 调用加了 20s 超时 + 指数退避重试（只重试 5xx / 429，4xx 立即失败）。

**内容质量**
- 模板支持 `{a|b|c}` 同义词随机，同一模板不会在几十个站留下完全相同的指纹。

## 两种提交方式

| 模式 | 行为 |
|---|---|
| **assist**（默认） | 填好表单就停下，把页面切到前台，你在侧栏点「已提交 / 跳过 / 失败」再继续下一条 |
| **auto** | 代点提交并自动读回执 |

博客评论外链属灰帽手段。默认模式**不替你点提交**；开 auto 前请自行确认目标站规则、控制频率。

## 安装

1. `chrome://extensions` → 打开右上角 **开发者模式**
2. **加载已解压的扩展程序** → 选本文件夹
3. 点扩展图标打开侧边栏 → 页脚 **设置** 填 API Key
4. 到 **资源库** 建一个身份 + 一个评论模板
5. **收集** 里输入竞品域名 → 勾选候选 → 建任务 → **发布** 里点 ▶

需要 Chrome 116+（`chrome.sidePanel`）。

## 目录

```
manifest.json          MV3 清单
background.js          service worker 入口，只做消息路由
sidepanel.html         侧栏骨架（语义化 header / main / footer）
src/shared/            constants · util · i18n（纯函数，可直接单测）
src/bg/                store · api · candidates · tasks · runner · tabs · logger · migrate
src/content/           detect（表单打分识别）· fill（拟真输入）· agent（消息端 + 页内提示条）
src/panel/             main + dom + api，views/ 下四个工作区各一个文件
src/styles/            tokens.css（oklch 设计令牌）· panel.css
tests/                 node:test 单测，零依赖
```

## 测试

```bash
npm test        # node --test tests/*.test.js
```

覆盖 URL 规范化与注入防护、模板渲染、候选去重与配额、任务统计与不可变更新。
UI 与内容脚本依赖真实 DOM / chrome API，需在 Chrome 里手测。

## 升级说明

v1 的候选库、API Key、姓名/邮箱/模板会在扩展更新时自动迁移（`src/bg/migrate.js`），
v1 版本已备份在同级目录 `gefei-backlink-extension.v1-backup/`。

## API 参考

- 文档：https://goanyapi.com/zh/docs/backlink-api
- 接口：`GET https://api.goanyapi.com/api/v1/backlink?domain=<域名>`，鉴权 `Authorization: Bearer <API_KEY>`
- 每次成功请求扣 3 credits，失败不扣；剩余积分显示在「收集」页右上角。
