import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";

dotenv.config();

import { handleMessage } from "./bot/gpt.js";
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory,
} from "./bot/storage.js";
import { stkPush } from "./bot/mpesa.js";

const { Client, LocalAuth } = pkg;

// 🚀 Setup Express
const app = express();

// ✅ Fix session folder for Railway
// ✅ Fix session folder for Railway
// Don't include ".wwebjs_auth" in the path, LocalAuth will append it automatically
const baseAuthPath = process.env.WA_DATA_PATH || "/tmp";

try {
  fs.mkdirSync(baseAuthPath, { recursive: true });
  console.log("✅ Auth base folder ready:", baseAuthPath);
} catch (err) {
  console.error("⚠️ Auth folder setup issue:", err.message);
}

// 🚀 Setup WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: baseAuthPath,  // LocalAuth will create .wwebjs_auth inside this
  }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// ✅ QR Code route
let latestQR = null;
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR code generated. Visit /qr to scan it.");
});

app.get("/qr", async (req, res) => {
  if (!latestQR) {
    return res.send("<h2>No QR generated yet. Check back soon.</h2>");
  }
  const qrImg = await qrcode.toDataURL(latestQR);
  res.send(`
    <html>
      <head><title>WhatsApp QR</title></head>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111;">
        <div>
          <h2 style="color:#fff;text-align:center;">Scan QR with WhatsApp</h2>
          <img src="${qrImg}" />
        </div>
      </body>
    </html>
  `);
});

// ✅ Ready event
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";

dotenv.config();

import { handleMessage } from "./bot/gpt.js";
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory,
} from "./bot/storage.js";
import { stkPush } from "./bot/mpesa.js";

const { Client, LocalAuth } = pkg;

// 🚀 Setup Express
const app = express();

// ✅ Fix session folder for Railway
// ✅ Fix session folder for Railway
// Don't include ".wwebjs_auth" in the path, LocalAuth will append it automatically
const baseAuthPath = process.env.WA_DATA_PATH || "/tmp";

try {
  fs.mkdirSync(baseAuthPath, { recursive: true });
  console.log("✅ Auth base folder ready:", baseAuthPath);
} catch (err) {
  console.error("⚠️ Auth folder setup issue:", err.message);
}

// 🚀 Setup WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: baseAuthPath,  // LocalAuth will create .wwebjs_auth inside this
  }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// ✅ QR Code route
let latestQR = null;
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR code generated. Visit /qr to scan it.");
});

app.get("/qr", async (req, res) => {
  if (!latestQR) {
    return res.send("<h2>No QR generated yet. Check back soon.</h2>");
  }
  const qrImg = await qrcode.toDataURL(latestQR);
  res.send(`
    <html>
      <head><title>WhatsApp QR</title></head>
      <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#111;">
        <div>
          <h2 style="color:#fff;text-align:center;">Scan QR with WhatsApp</h2>
          <img src="${qrImg}" />
        </div>
      </body>
    </html>
  `);
});

// ✅ Ready event
client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

client.on("message", async (msg) => {
  console.log("📩 Received message:", msg.body);

  if (msg.body.toLowerCase() === "ping") {
    await msg.reply("pong 🏓");
  }
});

  console.log("📩 Incoming:", number, text);

  // 🚫 Block banned users
  if (await isBanned(number)) {
    return msg.reply("🚫 You are banned from using this service.");
  }

  // 🛠️ Admin commands
  if (text.startsWith("/ban ")) {
    const toBan = text.split(" ")[1];
    await banUser(toBan);
    return msg.reply(`🚫 ${toBan} has been banned.`);
  }

  if (text.startsWith("/unban ")) {
    const toUnban = text.split(" ")[1];
    await unbanUser(toUnban);
    return msg.reply(`✅ ${toUnban} has been unbanned.`);
  }

  if (text === "/history") {
    const history = await getUserHistory(number);
    return msg.reply(`🕓 You have ${history.length} messages stored.`);
  }

  // 💰 Payment
  if (text.toLowerCase().startsWith("/pay")) {
    const parts = text.split(" ");
    const amount = parts[1];

    if (!amount) {
      return msg.reply("⚠️ Usage: /pay <amount>");
    }

    const phone = number.replace("@c.us", "").replace("@c.ke", "");

    console.log("💰 Payment attempt:", phone, amount);

    try {
      const res = await stkPush(phone, amount);
      console.log("✅ Safaricom response:", res.data || res);

      return msg.reply("📲 Payment request sent. Check your phone to complete.");
    } catch (err) {
      console.error("❌ M-Pesa error:", err.response?.data || err.message);
      return msg.reply("❌ Payment failed. Please try again later.");
    }
  }

  // 🤖 GPT response
  await saveUserMessage(number, "user", text);
  const reply = await handleMessage(number, text);
  await saveUserMessage(number, "bot", reply);

  msg.reply(reply);
});

client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
});

client.on("auth_failure", msg => {
  console.error("❌ Authentication failure:", msg);
});

client.on("disconnected", reason => {
  console.log("⚠️ WhatsApp disconnected:", reason);
});

// ✅ Start WhatsApp client
client.initialize();

// ✅ Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server running on http://localhost:${PORT}`);
});

client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
});

client.on("auth_failure", msg => {
  console.error("❌ Authentication failure:", msg);
});

client.on("disconnected", reason => {
  console.log("⚠️ WhatsApp disconnected:", reason);
});

// ✅ Start WhatsApp client
client.initialize();

// ✅ Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server running on http://localhost:${PORT}`);
});
