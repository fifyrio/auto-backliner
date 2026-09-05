# 外链机会助手 · Backlink Finder（Chrome 扩展）

一个 Manifest V3 Chrome 扩展，复刻「博客评论外链自动发现 + 拟真填充」的思路，数据源用 **GoAnyAPI Backlinks API** 替代拦截 Ahrefs/Semrush。

## 它做什么（对应文章的六步）

1. **采集** — 输入竞品域名，调 Backlinks API 拿 `topBacklinks`，每个 `urlFrom` 就是一个「可去发评论外链」的候选页面。
2. **过滤入库** — 后台按根域名去重（同一根域名默认最多 3 条），写入本地库。
3. **检测分类** — 打开候选页时，内容脚本自动识别评论表单 / 验证码，分类为 有表单 / 无表单 / 有验证码。
4. **验证** — 你在页面上人工确认能否发。
5. **填充** — 「拟真填充」按钮：先停顿模拟阅读 → 滚到评论区 → 逐字符输入（触发 React/Vue onChange，避免被反垃圾识别）→ 姓名/邮箱/网站/正文自动填好，正文与 website 字段都带你的链接。**提交按钮由你手动点击。**
6. **数据层** — 状态（未处理/有表单/已发布/跳过）回写本地库，可在仪表盘筛选、导出 CSV。

## 安装（加载到你的 Google Chrome）

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本文件夹 `gefei-backlink-extension`
4. 扩展出现后，点它的图标 → **打开发现仪表盘**（或右键 → 选项）

## 使用

1. 在设置页填 **GoAnyAPI Key**（仅存本地 `chrome.storage.sync`，不上传第三方），以及你的姓名/邮箱/网站 URL/锚文本/评论模板。
2. 在「发现外链机会」里粘贴 1 个或多个竞品域名，点 **发现外链机会**。
3. 候选列表里点 **打开** 逐个访问；页面右下角会弹出小面板显示分类。
4. 面板点 **拟真填充**，检查无误后手动提交；再点 **标记已发**。

## 文件结构

```
manifest.json      扩展清单（MV3）
background.js      service worker：调 Backlinks API + 去重入库
options.html/css/js  设置页 + 发现仪表盘 + 候选表
content.js/css     内容脚本：表单识别 + 拟真填充悬浮面板
popup.html/js      工具栏弹窗：当前页分类 + 快捷填充
icons/             图标
```

## 计费与合规提示

- Backlinks API 默认每次成功请求扣 **3 credits**，失败不扣。仪表盘右上角显示剩余积分。
- 博客评论外链属灰帽手段：本扩展**只做填充辅助、由你手动提交**，不做批量自动提交。请遵守目标站规则，控制频率、分散来源、内容有价值，避免被判定为 spam。

## API 参考

- Backlinks API 文档：https://goanyapi.com/zh/docs/backlink-api
- 接口：`GET https://api.goanyapi.com/api/v1/backlink?domain=<域名>`，鉴权 `Authorization: Bearer <API_KEY>`
