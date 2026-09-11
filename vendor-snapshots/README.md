# Vendor Snapshots

从独立项目拷贝过来的只读快照，用于后续合并进 Salesforce Quick Login 工具聚合平台。

| 目录 | 来源 | 状态 |
|------|------|------|
| Salesforce-Apexlog-Viewer | D:\projects\Salesforce-Apexlog-Viewer\salesforce-log-extension | 已拷贝（排除 node_modules/.git/*.zip） |
| Salesforce-Soql-Create | D:\projects\Salesforce-Soql-Create\soql_create | 已拷贝（排除 .git/参考/*.zip） |

快照时间（SOQL）: 2026-09-09 23:36:53

**注意：** 这些文件尚未接入扩展运行时；合并前不要改 vendor-snapshots 当正式源码，正式合入应迁到 `src/tools/...`。

## 两工具共性
- 均为 Cookie `sid` → Bearer REST（与 Quick Login 的 SOAP 登录互补）
- 合并时应优先抽取共享 `SfSession` / `SfRest`，UI 分别 Vue 化

## 术语与合并讨论
- 统一叫法见 [`docs/terminology.md`](../docs/terminology.md)（宿主、工具模块、扩展账户 vs SF 环境等）
