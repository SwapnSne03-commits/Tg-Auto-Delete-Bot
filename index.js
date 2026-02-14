require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");


// ================= WEB SERVER (Render fix) =================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot running"));
app.listen(PORT, () => console.log("Web server running"));


// ================= TELEGRAM BOT =================

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

console.log("Ultimate bot running...");


// ================= OWNER =================

const OWNERS = [7859995064]; // নিজের ID বসাও
let globalAdmins = [];


// ================= PER GROUP SETTINGS =================

let groups = {};

function getGroup(chatId) {
  if (!groups[chatId]) {
    groups[chatId] = {
      deleteTime: 10000,
      enabled: true,
      linkFilter: false,
      autoCleanInterval: null,
      deletedCount: 0
    };
  }
  return groups[chatId];
}


// ================= TIME PARSER =================

function parseTime(input) {
  const match = input.match(/^(\d+)([smhd])$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60000;
    case "h": return value * 3600000;
    case "d": return value * 86400000;
  }
}


// ================= PERMISSION =================

function isAuthorized(id) {
  return OWNERS.includes(id) || globalAdmins.includes(id);
}


// ================= DELETE FUNCTION =================

function scheduleDelete(chatId, messageId, group) {
  setTimeout(() => {
    bot.deleteMessage(chatId, messageId)
      .then(() => group.deletedCount++)
      .catch(() => {});
  }, group.deleteTime);
}


// ================= COMMANDS =================

// SET TIME
bot.onText(/\/set (.+)/, (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;

  const group = getGroup(msg.chat.id);
  const ms = parseTime(match[1]);

  if (!ms) return bot.sendMessage(msg.chat.id, "Use 10s / 5m / 2h / 1d");

  group.deleteTime = ms;
  bot.sendMessage(msg.chat.id, "Delete time updated");
});


// LINK FILTER
bot.onText(/\/link (on|off)/, (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;

  const group = getGroup(msg.chat.id);
  group.linkFilter = match[1] === "on";

  bot.sendMessage(msg.chat.id, "Link filter " + match[1]);
});


// DISABLE / ENABLE
bot.onText(/\/disable/, (msg) => {
  if (!isAuthorized(msg.from.id)) return;

  getGroup(msg.chat.id).enabled = false;
  bot.sendMessage(msg.chat.id, "Bot disabled in this chat");
});

bot.onText(/\/enable/, (msg) => {
  if (!isAuthorized(msg.from.id)) return;

  getGroup(msg.chat.id).enabled = true;
  bot.sendMessage(msg.chat.id, "Bot enabled in this chat");
});


// AUTO CLEAN
bot.onText(/\/autoclean (.+)/, (msg, match) => {
  if (!isAuthorized(msg.from.id)) return;

  const group = getGroup(msg.chat.id);

  if (match[1] === "off") {
    if (group.autoCleanInterval) clearInterval(group.autoCleanInterval);
    group.autoCleanInterval = null;
    return bot.sendMessage(msg.chat.id, "Auto clean disabled");
  }

  const ms = parseTime(match[1]);
  if (!ms) return bot.sendMessage(msg.chat.id, "Invalid time format");

  if (group.autoCleanInterval) clearInterval(group.autoCleanInterval);

  group.autoCleanInterval = setInterval(() => {
    bot.sendMessage(msg.chat.id, "🧹 Auto clean running...");
  }, ms);

  bot.sendMessage(msg.chat.id, "Auto clean enabled");
});


// STATS
bot.onText(/\/stats/, (msg) => {
  const group = getGroup(msg.chat.id);

  bot.sendMessage(msg.chat.id,
    `Enabled: ${group.enabled}\n` +
    `Delete Time: ${group.deleteTime / 1000}s\n` +
    `Link Filter: ${group.linkFilter}\n` +
    `Auto Clean: ${group.autoCleanInterval ? "ON" : "OFF"}\n` +
    `Deleted Count: ${group.deletedCount}`
  );
});


// ADD ADMIN
bot.onText(/\/admin (\d+)/, (msg, match) => {
  if (!OWNERS.includes(msg.from.id)) return;

  const id = parseInt(match[1]);
  if (!globalAdmins.includes(id)) globalAdmins.push(id);

  bot.sendMessage(msg.chat.id, "Admin added");
});


// ================= UNIVERSAL MESSAGE HANDLER =================

function handleMessage(msg) {
  if (msg.chat.type === "private") return;

  const group = getGroup(msg.chat.id);
  if (!group.enabled) return;

  if (msg.text && msg.text.startsWith("/")) return;

  // Link filter
  if (group.linkFilter && msg.text && msg.text.includes("http")) {
    return bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
  }

  scheduleDelete(msg.chat.id, msg.message_id, group);
}


// Normal message
bot.on("message", handleMessage);

// Edited message
bot.on("edited_message", handleMessage);

// Channel post
bot.on("channel_post", handleMessage);

// Edited channel post
bot.on("edited_channel_post", handleMessage);
