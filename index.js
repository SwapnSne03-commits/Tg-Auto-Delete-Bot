require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");


// ======================
// FAKE WEB SERVER (Render fix)
// ======================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is running");
});

app.listen(PORT, () => {
  console.log("Web server started on port " + PORT);
});


// ======================
// TELEGRAM BOT
// ======================

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

console.log("Telegram bot running...");


// ===== OWNER / ADMIN =====

const OWNERS = [
  7859995064 // <-- তোমার Telegram ID বসাও
];

const ADMINS = [];

function isAuthorized(id) {
  return OWNERS.includes(id) || ADMINS.includes(id);
}

function deny(chatId) {
  bot.sendMessage(chatId, "Not authorized ❌");
}


// ===== SETTINGS =====

let deleteTime = 10000;
let enabled = true;
let deleteAdmins = false;


// ===== COMMANDS =====

bot.onText(/\/set (\d+)/, (msg, match) => {
  if (!isAuthorized(msg.from.id)) return deny(msg.chat.id);

  deleteTime = parseInt(match[1]) * 1000;
  bot.sendMessage(msg.chat.id, `Delete time set to ${match[1]} sec`);
});

bot.onText(/\/on/, (msg) => {
  if (!isAuthorized(msg.from.id)) return deny(msg.chat.id);
  enabled = true;
  bot.sendMessage(msg.chat.id, "Auto delete ON");
});

bot.onText(/\/off/, (msg) => {
  if (!isAuthorized(msg.from.id)) return deny(msg.chat.id);
  enabled = false;
  bot.sendMessage(msg.chat.id, "Auto delete OFF");
});

bot.onText(/\/admin (on|off)/, (msg, match) => {
  if (!isAuthorized(msg.from.id)) return deny(msg.chat.id);

  deleteAdmins = match[1] === "on";
  bot.sendMessage(msg.chat.id, `Admin delete ${deleteAdmins ? "ON" : "OFF"}`);
});


// ===== AUTO DELETE =====

bot.on("message", async (msg) => {
  if (!enabled) return;
  if (msg.chat.type === "private") return;
  if (msg.text && msg.text.startsWith("/")) return;

  try {
    const member = await bot.getChatMember(msg.chat.id, msg.from.id);

    if (!deleteAdmins && ["administrator", "creator"].includes(member.status)) return;

    setTimeout(() => {
      bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    }, deleteTime);

  } catch {}
});


// ===== NEW CHAT LOG =====

bot.on("my_chat_member", (update) => {
  const chat = update.chat;
  const newStatus = update.new_chat_member.status;

  if (newStatus === "member" || newStatus === "administrator") {
    const text =
      `📢 Bot added\nName: ${chat.title}\nID: ${chat.id}\nType: ${chat.type}`;

    OWNERS.forEach(id => bot.sendMessage(id, text));
  }
});
