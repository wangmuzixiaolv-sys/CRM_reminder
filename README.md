# CRM Telegram 自动提醒

每天自动检查你的 Notion 人脉管理数据库，根据联系频率和下次联系日期，发送 Telegram 提醒。

## 提醒规则

| 联系频率 | 触发时间 |
|---------|---------|
| 每周 | 每周一 |
| 每月 | 每月 1 日 |
| 每季度 | 1月、4月、7月、10月 1 日 |
| 每半年 | 1月 1 日、7月 1 日 |
| 每年 | 1月 1 日 |
| 下次联系日期到期 | 随时触发（无论频率） |

运行时间：每天早上 9:00（新加坡时间）

---

## 部署步骤

### 第一步：准备 Notion Token

1. 打开 https://www.notion.so/my-integrations
2. 点击「New Integration」，命名为「CRM Reminder」
3. 权限勾选：Read content（只需要读权限）
4. 复制 Internal Integration Token（`secret_xxx...`）
5. 回到你的 CRM 数据库页面，点右上角「...」→「Connect to」→ 选择刚创建的 Integration

### 第二步：准备 Telegram Bot

1. 在 Telegram 搜索 `@BotFather`，发送 `/newbot`
2. 按提示命名，获得 Bot Token（格式：`123456:ABCdef...`）
3. 获取你的 Chat ID：给 `@userinfobot` 发任意消息，它会回复你的 ID

### 第三步：创建 GitHub 仓库

1. 在 GitHub 新建一个**私有仓库**（建议私有，保护 Token）
2. 将 `remind.js`、`.github/workflows/crm-reminder.yml` 上传到仓库根目录

   目录结构：
   ```
   your-repo/
   ├── remind.js
   └── .github/
       └── workflows/
           └── crm-reminder.yml
   ```

### 第四步：设置 GitHub Secrets

在仓库页面 → Settings → Secrets and variables → Actions → New repository secret

添加以下 4 个 secret：

| Secret 名称 | 值 |
|------------|---|
| `NOTION_TOKEN` | `secret_xxx...`（你的 Notion Integration Token） |
| `NOTION_DB_ID` | `e449a011b7d04c2c9ad4043634f67149` |
| `TELEGRAM_TOKEN` | `123456:ABCdef...`（Bot Token） |
| `TELEGRAM_CHAT_ID` | 你的 Telegram Chat ID |

### 第五步：测试

1. 在仓库页面 → Actions → CRM Daily Reminder
2. 点击「Run workflow」手动触发
3. 查看运行日志，检查是否成功发送

---

## 消息示例

```
📋 CRM 每日联系提醒
📆 2026-04-18（新加坡时间）

今天共 3 人需要联系：
  🔴 逾期：1 人
  🟠 今天：1 人
  🔵 定期提醒：1 人

────────────────────
🔴 张三 — 逾期 5 天
💼 ABC 科技
📍 新加坡
🤝 行业人脉 · 较熟
🔁 联系频率：每月
📅 下次联系：2026-04-13
📝 上次聊了融资计划
🔗 在 Notion 中查看
```

---

## 修改运行时间

编辑 `.github/workflows/crm-reminder.yml` 中的 cron 表达式：

```yaml
# 格式：分 时 日 月 周（UTC 时间）
# 新加坡 = UTC+8，早上 9 点 = UTC 01:00
- cron: "0 1 * * *"
```

常用时间参考（新加坡时间 → UTC）：
- 早上 8:00 → `0 0 * * *`
- 早上 9:00 → `0 1 * * *`
- 早上 10:00 → `0 2 * * *`
