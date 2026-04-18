/**
 * CRM Telegram Reminder
 * 每天运行，根据联系频率规则和下次联系日期，发送 Telegram 提醒
 */

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID = process.env.NOTION_DB_ID; // e449a011b7d04c2c9ad4043634f67149
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ─── 日期工具 ────────────────────────────────────────────────────────────────

function getToday() {
  // 使用新加坡时区 (UTC+8)
  const now = new Date();
  const sgTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  return {
    date: sgTime,
    dayOfWeek: sgTime.getDay(),   // 0=周日, 1=周一
    dayOfMonth: sgTime.getDate(),
    month: sgTime.getMonth() + 1, // 1-12
    year: sgTime.getFullYear(),
    isoDate: sgTime.toISOString().split("T")[0],
  };
}

/**
 * 判断今天是否应该根据联系频率发送提醒
 */
function shouldRemindByFrequency(frequency, today) {
  switch (frequency) {
    case "每周":
      // 每周一 (dayOfWeek === 1)
      return today.dayOfWeek === 1;

    case "每月":
      // 每月第一天
      return today.dayOfMonth === 1;

    case "每季度":
      // 1月、4月、7月、10月的第一天
      return today.dayOfMonth === 1 && [1, 4, 7, 10].includes(today.month);

    case "每半年":
      // 1月1日、7月1日
      return today.dayOfMonth === 1 && [1, 7].includes(today.month);

    case "每年":
      // 1月1日
      return today.dayOfMonth === 1 && today.month === 1;

    default:
      return false;
  }
}

/**
 * 判断下次联系日期是否到期（今天或已过期）
 */
function isContactDue(nextContactDate, todayIso) {
  if (!nextContactDate) return false;
  return nextContactDate <= todayIso;
}

// ─── Notion API ──────────────────────────────────────────────────────────────

async function fetchContacts() {
  const url = `https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      page_size: 100,
      sorts: [{ property: "下次联系日期", direction: "ascending" }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Notion API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.results.map(parseContact);
}

function parseContact(page) {
  const props = page.properties;

  const getName = (p) =>
    p?.title?.[0]?.plain_text || p?.rich_text?.[0]?.plain_text || "";

  return {
    id: page.id,
    url: page.url,
    name: getName(props["姓名"]),
    frequency: props["联系频率建议"]?.select?.name || null,
    nextContactDate: props["下次联系日期"]?.date?.start || null,
    lastContactDate: props["上次联系日期"]?.date?.start || null,
    relationship: props["关系"]?.select?.name || null,
    familiarity: props["熟悉度"]?.select?.name || null,
    city: props["所在城市"]?.rich_text?.[0]?.plain_text || null,
    job: props["职业/公司"]?.rich_text?.[0]?.plain_text || null,
    notes: props["备注/现状"]?.rich_text?.[0]?.plain_text || null,
    aiSuggestion: props["AI 联系建议"]?.rich_text?.[0]?.plain_text || null,
  };
}

// ─── 筛选逻辑 ────────────────────────────────────────────────────────────────

function filterContactsToRemind(contacts, today) {
  const toRemind = [];

  for (const contact of contacts) {
    if (!contact.name) continue;

    const dueByDate = isContactDue(contact.nextContactDate, today.isoDate);
    const dueByFrequency = contact.frequency
      ? shouldRemindByFrequency(contact.frequency, today)
      : false;

    if (dueByDate || dueByFrequency) {
      // 计算逾期天数
      let daysDiff = null;
      if (contact.nextContactDate) {
        const next = new Date(contact.nextContactDate);
        const now = new Date(today.isoDate);
        daysDiff = Math.round((next - now) / 86400000);
      }

      toRemind.push({
        ...contact,
        daysDiff,
        reason: dueByDate ? "date" : "frequency",
      });
    }
  }

  // 逾期的排前面，按日期升序
  toRemind.sort((a, b) => {
    if (a.daysDiff !== null && b.daysDiff !== null) return a.daysDiff - b.daysDiff;
    if (a.daysDiff !== null) return -1;
    return 1;
  });

  return toRemind;
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Telegram error: ${response.status} ${err}`);
  }
  return response.json();
}

function buildContactMessage(contact, today) {
  const lines = [];

  // 状态标识
  let statusEmoji = "🟡";
  let statusText = "";
  if (contact.daysDiff !== null && contact.daysDiff < 0) {
    statusEmoji = "🔴";
    statusText = `逾期 ${Math.abs(contact.daysDiff)} 天`;
  } else if (contact.daysDiff === 0) {
    statusEmoji = "🟠";
    statusText = "今天";
  } else if (contact.daysDiff !== null) {
    statusEmoji = "🟢";
    statusText = `${contact.daysDiff} 天后`;
  } else if (contact.frequency) {
    statusEmoji = "🔵";
    statusText = `定期提醒（${contact.frequency}）`;
  }

  lines.push(`${statusEmoji} <b>${contact.name}</b> — ${statusText}`);

  if (contact.job) lines.push(`💼 ${contact.job}`);
  if (contact.city) lines.push(`📍 ${contact.city}`);
  if (contact.relationship) lines.push(`🤝 ${contact.relationship}${contact.familiarity ? ` · ${contact.familiarity}` : ""}`);
  if (contact.frequency) lines.push(`🔁 联系频率：${contact.frequency}`);
  if (contact.nextContactDate) lines.push(`📅 下次联系：${contact.nextContactDate}`);
  if (contact.lastContactDate) lines.push(`🕐 上次联系：${contact.lastContactDate}`);
  if (contact.notes) lines.push(`📝 ${contact.notes}`);
  if (contact.aiSuggestion) lines.push(`💡 AI 建议：${contact.aiSuggestion}`);
  lines.push(`🔗 <a href="${contact.url}">在 Notion 中查看</a>`);

  return lines.join("\n");
}

function buildSummaryMessage(contacts, today) {
  const overdueCount = contacts.filter((c) => c.daysDiff !== null && c.daysDiff < 0).length;
  const todayCount = contacts.filter((c) => c.daysDiff === 0).length;
  const upcomingCount = contacts.filter((c) => c.daysDiff === null || c.daysDiff > 0).length;

  const lines = [
    `📋 <b>CRM 每日联系提醒</b>`,
    `📆 ${today.isoDate}（新加坡时间）`,
    ``,
    `今天共 <b>${contacts.length}</b> 人需要联系：`,
  ];

  if (overdueCount > 0) lines.push(`  🔴 逾期：${overdueCount} 人`);
  if (todayCount > 0) lines.push(`  🟠 今天：${todayCount} 人`);
  if (upcomingCount > 0) lines.push(`  🔵 定期提醒：${upcomingCount} 人`);

  lines.push(`\n${"─".repeat(20)}`);
  return lines.join("\n");
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 CRM Reminder 启动");

  // 验证环境变量
  const required = { NOTION_TOKEN, NOTION_DB_ID, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID };
  for (const [key, val] of Object.entries(required)) {
    if (!val) throw new Error(`缺少环境变量: ${key}`);
  }

  const today = getToday();
  console.log(`📅 今天：${today.isoDate}，周${["日","一","二","三","四","五","六"][today.dayOfWeek]}`);

  // 1. 读取所有联系人
  console.log("📖 读取 Notion CRM...");
  const allContacts = await fetchContacts();
  console.log(`✅ 共读取 ${allContacts.length} 位联系人`);

  // 2. 筛选今天需要提醒的
  const toRemind = filterContactsToRemind(allContacts, today);
  console.log(`🎯 今天需要联系：${toRemind.length} 人`);

  if (toRemind.length === 0) {
    console.log("✨ 今天没有需要联系的人，跳过发送");

    // 可选：发送一条"今天无提醒"的消息（注释掉则不发）
    // await sendTelegram(`✅ CRM 提醒\n${today.isoDate}\n今天没有需要联系的人 🎉`);
    return;
  }

  // 3. 发送汇总消息
  await sendTelegram(buildSummaryMessage(toRemind, today));
  await sleep(500);

  // 4. 逐一发送每位联系人的详情
  let sent = 0;
  for (const contact of toRemind) {
    try {
      const msg = buildContactMessage(contact, today);
      await sendTelegram(msg);
      sent++;
      console.log(`  ✉️  ${contact.name}`);
      await sleep(400); // 避免 Telegram 限速
    } catch (err) {
      console.error(`  ❌ 发送 ${contact.name} 失败:`, err.message);
    }
  }

  console.log(`\n🎉 完成！共发送 ${sent}/${toRemind.length} 条提醒`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("💥 运行失败:", err);
  process.exit(1);
});
