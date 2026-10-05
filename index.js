require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { MongoClient } = require("mongodb");

// ================= WEB SERVER (Render fix) =================

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("Bot running"));

app.listen(PORT, () => {
  console.log("Web server running");
});

// ================= OWNER =================

const OWNERS = [7859995064];

// ================= MONGODB =================

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI environment variable is missing.");
  process.exit(1);
}

const mongoClient = new MongoClient(MONGODB_URI);

let db;
let groupsCollection;
let settingsCollection;

// In-memory cache.
// MongoDB is the permanent storage.
let globalAdmins = [];
let groups = {};

// ================= DATABASE FUNCTIONS =================

async function connectDatabase() {
  try {
    await mongoClient.connect();

    db = mongoClient.db("telegram_autodelete_bot");

    groupsCollection = db.collection("groups");
    settingsCollection = db.collection("settings");

    // Make chatId unique so one group has only one settings document.
    await groupsCollection.createIndex(
      { chatId: 1 },
      { unique: true }
    );

    console.log("MongoDB connected successfully.");

    await loadSettings();

  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }
}

// ================= LOAD SETTINGS =================

async function loadSettings() {
  try {
    // Load global admins
    const settings = await settingsCollection.findOne({
      _id: "global"
    });

    if (settings && Array.isArray(settings.globalAdmins)) {
      globalAdmins = settings.globalAdmins;
    } else {
      globalAdmins = [];
    }

    // Load all groups
    const savedGroups = await groupsCollection.find({}).toArray();

    groups = {};

    for (const savedGroup of savedGroups) {
      const chatId = String(savedGroup.chatId);

      groups[chatId] = {
        deleteTime:
          typeof savedGroup.deleteTime === "number"
            ? savedGroup.deleteTime
            : 10000,

        enabled:
          typeof savedGroup.enabled === "boolean"
            ? savedGroup.enabled
            : true,

        linkFilter:
          typeof savedGroup.linkFilter === "boolean"
            ? savedGroup.linkFilter
            : false,

        autoCleanInterval: null,

        autoCleanTime:
          typeof savedGroup.autoCleanTime === "number"
            ? savedGroup.autoCleanTime
            : null,

        deletedCount:
          typeof savedGroup.deletedCount === "number"
            ? savedGroup.deletedCount
            : 0
      };
    }

    console.log(
      `Loaded ${savedGroups.length} group settings and ${globalAdmins.length} global admin(s).`
    );

  } catch (error) {
    console.error("Failed to load settings:", error);
    process.exit(1);
  }
}

// ================= SAVE GROUP SETTINGS =================

async function saveGroup(chatId, group) {
  try {
    await groupsCollection.updateOne(
      { chatId: chatId },
      {
        $set: {
          chatId: chatId,
          deleteTime: group.deleteTime,
          enabled: group.enabled,
          linkFilter: group.linkFilter,
          autoCleanTime: group.autoCleanTime,
          deletedCount: group.deletedCount,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error(
      `Failed to save group settings for ${chatId}:`,
      error
    );
  }
}

// ================= SAVE ADMINS =================

async function saveAdmins() {
  try {
    await settingsCollection.updateOne(
      { _id: "global" },
      {
        $set: {
          globalAdmins: globalAdmins,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error("Failed to save global admins:", error);
  }
}

// ================= PER GROUP SETTINGS =================

function getGroup(chatId) {
  const key = String(chatId);

  if (!groups[key]) {
    groups[key] = {
      deleteTime: 10000,
      enabled: true,
      linkFilter: false,
      autoCleanInterval: null,
      autoCleanTime: null,
      deletedCount: 0
    };

    // Save new group settings asynchronously.
    saveGroup(key, groups[key]);
  }

  return groups[key];
}

// ================= RESTORE AUTO CLEAN =================

function restoreAutoClean(chatId, group) {
  if (!group.autoCleanTime) {
    return;
  }

  if (group.autoCleanInterval) {
    clearInterval(group.autoCleanInterval);
  }

  group.autoCleanInterval = setInterval(() => {
    bot.sendMessage(chatId, "🧹 Auto clean running...")
      .catch(() => {});
  }, group.autoCleanTime);

  console.log(
    `Auto clean restored for ${chatId}: ${group.autoCleanTime}ms`
  );
}

// ================= TIME PARSER =================

function parseTime(input) {
  const match = input.match(/^(\d+)([smhd])$/);

  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;

    case "m":
      return value * 60000;

    case "h":
      return value * 3600000;

    case "d":
      return value * 86400000;

    default:
      return null;
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
      .then(async () => {
        group.deletedCount++;

        await groupsCollection.updateOne(
          { chatId: String(chatId) },
          {
            $inc: {
              deletedCount: 1
            }
          }
        );
      })
      .catch(() => {});
  }, group.deleteTime);
}

// ================= TELEGRAM BOT =================

let bot;

// ================= START BOT =================

async function startBot() {
  // Connect to MongoDB and load saved settings first.
  await connectDatabase();

  // Create Telegram bot after database is ready.
  bot = new TelegramBot(process.env.TOKEN, {
    polling: true
  });

  console.log("Ultimate bot running...");

  // Restore Auto Clean timers for saved groups.
  for (const chatId of Object.keys(groups)) {
    restoreAutoClean(chatId, groups[chatId]);
  }

  // ================= COMMANDS =================

  // SET TIME
  bot.onText(/\/set (.+)/, async (msg, match) => {
    if (!isAuthorized(msg.from.id)) return;

    const group = getGroup(msg.chat.id);
    const ms = parseTime(match[1]);

    if (!ms) {
      return bot.sendMessage(
        msg.chat.id,
        "Use 10s / 5m / 2h / 1d"
      );
    }

    group.deleteTime = ms;

    await saveGroup(String(msg.chat.id), group);

    bot.sendMessage(
      msg.chat.id,
      "Delete time updated"
    );
  });

  // LINK FILTER
  bot.onText(/\/link (on|off)/, async (msg, match) => {
    if (!isAuthorized(msg.from.id)) return;

    const group = getGroup(msg.chat.id);

    group.linkFilter = match[1] === "on";

    await saveGroup(String(msg.chat.id), group);

    bot.sendMessage(
      msg.chat.id,
      "Link filter " + match[1]
    );
  });

  // DISABLE
  bot.onText(/\/disable/, async (msg) => {
    if (!isAuthorized(msg.from.id)) return;

    const group = getGroup(msg.chat.id);

    group.enabled = false;

    await saveGroup(String(msg.chat.id), group);

    bot.sendMessage(
      msg.chat.id,
      "Bot disabled in this chat"
    );
  });

  // ENABLE
  bot.onText(/\/enable/, async (msg) => {
    if (!isAuthorized(msg.from.id)) return;

    const group = getGroup(msg.chat.id);

    group.enabled = true;

    await saveGroup(String(msg.chat.id), group);

    bot.sendMessage(
      msg.chat.id,
      "Bot enabled in this chat"
    );
  });

  // AUTO CLEAN
  bot.onText(/\/autoclean (.+)/, async (msg, match) => {
    if (!isAuthorized(msg.from.id)) return;

    const group = getGroup(msg.chat.id);

    // Disable auto clean
    if (match[1] === "off") {
      if (group.autoCleanInterval) {
        clearInterval(group.autoCleanInterval);
      }

      group.autoCleanInterval = null;
      group.autoCleanTime = null;

      await saveGroup(String(msg.chat.id), group);

      return bot.sendMessage(
        msg.chat.id,
        "Auto clean disabled"
      );
    }

    const ms = parseTime(match[1]);

    if (!ms) {
      return bot.sendMessage(
        msg.chat.id,
        "Invalid time format"
      );
    }

    if (group.autoCleanInterval) {
      clearInterval(group.autoCleanInterval);
    }

    group.autoCleanTime = ms;

    group.autoCleanInterval = setInterval(() => {
      bot.sendMessage(
        msg.chat.id,
        "🧹 Auto clean running..."
      ).catch(() => {});
    }, ms);

    await saveGroup(String(msg.chat.id), group);

    bot.sendMessage(
      msg.chat.id,
      "Auto clean enabled"
    );
  });

  // STATS
  bot.onText(/\/stats/, (msg) => {
    const group = getGroup(msg.chat.id);

    bot.sendMessage(
      msg.chat.id,
      `Enabled: ${group.enabled}\n` +
      `Delete Time: ${group.deleteTime / 1000}s\n` +
      `Link Filter: ${group.linkFilter}\n` +
      `Auto Clean: ${group.autoCleanTime ? "ON" : "OFF"}\n` +
      `Deleted Count: ${group.deletedCount}`
    );
  });

  // ADD ADMIN
  bot.onText(/\/admin (\d+)/, async (msg, match) => {
    if (!OWNERS.includes(msg.from.id)) return;

    const id = parseInt(match[1]);

    if (!globalAdmins.includes(id)) {
      globalAdmins.push(id);

      await saveAdmins();
    }

    bot.sendMessage(
      msg.chat.id,
      "Admin added"
    );
  });

  // ================= UNIVERSAL MESSAGE HANDLER =================

  function handleMessage(msg) {
    if (msg.chat.type === "private") return;

    const group = getGroup(msg.chat.id);

    if (!group.enabled) return;

    if (msg.text && msg.text.startsWith("/")) return;

    // Link filter
    if (
      group.linkFilter &&
      msg.text &&
      msg.text.includes("http")
    ) {
      return bot
        .deleteMessage(msg.chat.id, msg.message_id)
        .catch(() => {});
    }

    scheduleDelete(
      msg.chat.id,
      msg.message_id,
      group
    );
  }

  // Normal message
  bot.on("message", handleMessage);

  // Edited message
  bot.on("edited_message", handleMessage);

  // Channel post
  bot.on("channel_post", handleMessage);

  // Edited channel post
  bot.on(
    "edited_channel_post",
    handleMessage
  );
}

startBot().catch((error) => {
  console.error("Bot startup failed:", error);
  process.exit(1);
});
