// index.js
import express from "express";
import dotenv from "dotenv";
import qrcode from "qrcode";
import pkg from "whatsapp-web.js";

import { handleMessage } from "./bot/gpt.js";
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory,
} from "./bot/storage.js";
import { stkPush } from "./bot/mpesa.js";

dotenv.config();
const { Client, LocalAuth } = pkg;

// 🚀 Setup Express server
const app = express();

// 🚀 Setup WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-zygote",
      "--disable-gpu",
    ],
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
  res.send(`<img src="${qrImg}" />`);
});

// ✅ WhatsApp ready
client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

// ✅ Message handler
client.on("message", async (msg) => {
  const number = msg.from;
  const text = msg.body.trim();

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

      return msg.reply(
        "📲 Payment request sent. Check your phone to complete."
      );
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

// ✅ Start WhatsApp client
client.initialize();

// ✅ Start Express server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🌍 Server running on http://localhost:${PORT}`);
});

