require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.TOKEN, { polling: true });

console.log("Bot running...");

let deleteTime = 10000;
let enabled = true;
let deleteAdmins = false;


// set time
bot.onText(/\/set (\d+)/, (msg, match) => {
  deleteTime = parseInt(match[1]) * 1000;
  bot.sendMessage(msg.chat.id, `Delete time set to ${match[1]} sec`);
});

// on/off
bot.onText(/\/on/, (msg) => {
  enabled = true;
  bot.sendMessage(msg.chat.id, "Auto delete ON");
});

bot.onText(/\/off/, (msg) => {
  enabled = false;
  bot.sendMessage(msg.chat.id, "Auto delete OFF");
});

// admin toggle
bot.onText(/\/admin (on|off)/, (msg, match) => {
  deleteAdmins = match[1] === "on";
  bot.sendMessage(msg.chat.id, `Admin delete ${deleteAdmins ? "ON" : "OFF"}`);
});


// auto delete
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
