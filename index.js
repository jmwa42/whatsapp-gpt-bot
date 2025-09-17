// index.js
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

// 🚀 Express
const app = express();

// ✅ Session base folder (Railway safe)
const baseAuthPath = process.env.WA_DATA_PATH || "/tmp";
try {
  fs.mkdirSync(baseAuthPath, { recursive: true });
  console.log("✅ Auth base folder ready:", baseAuthPath);
} catch (err) {
  console.error("⚠️ Auth folder setup issue:", err.message);
}

// 🚀 WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: baseAuthPath, // LocalAuth auto-adds `.wwebjs_auth`
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-software-rasterizer",
      "--mute-audio",
    ],
  },
});

// ✅ QR Code storage
let latestQR = null;
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR generated — open /qr to scan");
});

// ✅ Express route for QR
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

// ✅ Events
client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");

  // Watchdog: restart if READY not fired in 60s
  const watchdog = setTimeout(() => {
    console.error("❌ READY not fired in 60s → restarting client...");
    client.destroy().then(() => client.initialize());
  }, 60000);

  client.once("ready", () => {
    clearTimeout(watchdog);
    console.log("✅ WhatsApp client is READY!");
  });
});

client.on("message", async (msg) => {
  console.log("📩 Incoming:", msg.from, msg.body);

  const number = msg.from;
  const text = msg.body;

  if (text.toLowerCase() === "ping") {
    return msg.reply("pong 🏓");
  }

  if (await isBanned(number)) {
    return msg.reply("🚫 You are banned from using this service.");
  }

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

  if (text.toLowerCase().startsWith("/pay")) {
    const parts = text.split(" ");
    const amount = parts[1];
    if (!amount) return msg.reply("⚠️ Usage: /pay <amount>");

    const phone = number.replace("@c.us", "");
    console.log("💰 Payment attempt:", phone, amount);

    try {
      const res = await stkPush(phone, amount);
      console.log("✅ Safaricom response:", res.data || res);
      return msg.reply("📲 Payment request sent. Check your phone to complete.");
    } catch (err) {
      console.error("❌ M-Pesa error:", err.response?.data || err.message);
      return msg.reply("❌ Payment failed. Try again later.");
    }
  }

  await saveUserMessage(number, "user", text);
  const reply = await handleMessage(number, text);
  await saveUserMessage(number, "bot", reply);

  msg.reply(reply);
});

client.on("auth_failure", (m) => console.error("❌ Auth failure:", m));
client.on("disconnected", (r) => console.warn("⚠️ Disconnected:", r));

// 🚀 Start
client.initialize();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server running → http://localhost:${PORT}`);
});

