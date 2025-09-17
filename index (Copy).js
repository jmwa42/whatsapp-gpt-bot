import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";

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

// Express
const app = express();

// Auth path: pass parent directory (LocalAuth will create .wwebjs_auth inside it)
const WA_BASE = process.env.WA_DATA_PATH || "/tmp"; // set to your mounted volume (e.g. /mnt/data)
const AUTH_FULL_PARENT = path.resolve(WA_BASE);

// ensure folder exists (best-effort)
try {
  fs.mkdirSync(AUTH_FULL_PARENT, { recursive: true });
  console.log("✅ Auth base folder ready:", AUTH_FULL_PARENT);
} catch (e) {
  console.error("⚠️ Failed to ensure auth base folder:", e.message);
}

// Debug route to inspect contents of auth folder (ONLY enable in DEBUG mode)
if (process.env.DEBUG === "true") {
  app.get("/debug-auth", (req, res) => {
    try {
      const dir = fs.existsSync(AUTH_FULL_PARENT) ? AUTH_FULL_PARENT : "/tmp";
      const listing = fs.readdirSync(dir).map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, isDir: stat.isDirectory(), size: stat.size };
      });
      res.json({ dir, listing });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// WhatsApp client (pass the parent; LocalAuth will create .wwebjs_auth inside)
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: AUTH_FULL_PARENT, // do not include ".wwebjs_auth" here
  }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ],
  },
});

// QR endpoint
let latestQR = null;
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR code generated. Visit /qr to scan it.");
});

app.get("/qr", async (req, res) => {
  if (!latestQR) return res.send("<h2>No QR generated yet. Check back soon.</h2>");
  try {
    const qrImg = await qrcode.toDataURL(latestQR);
    res.send(`<html><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff">
      <h2>Scan QR with WhatsApp</h2><img src="${qrImg}"/>
      <p style="opacity:.7">Refresh to update if QR rotated.</p></body></html>`);
  } catch (err) {
    res.status(500).send("Error generating QR: " + err.message);
  }
});

// lifecycle logging
client.on("authenticated", () => console.log("🔑 WhatsApp authenticated."));
client.on("auth_failure", msg => console.error("❌ Authentication failure:", msg));
client.on("ready", () => console.log("✅ WhatsApp client is ready!"));
client.on("disconnected", reason => console.log("⚠️ WhatsApp disconnected:", reason));

// message handler (debug-friendly)
client.on("message", async (msg) => {
  try {
    const number = msg.from;
    const text = (msg.body || "").trim();
    console.log("📩 Incoming:", number, text);

    // a quick ping check
    if (text.toLowerCase() === "ping") {
      await msg.reply("pong 🏓");
      return;
    }

    // banned test
    if (await isBanned(number)) {
      await msg.reply("🚫 You are banned from using this service.");
      return;
    }

    // admin commands (example)
    if (text.startsWith("/ban ")) {
      const toBan = text.split(" ")[1];
      await banUser(toBan);
      await msg.reply(`🚫 ${toBan} has been banned.`);
      return;
    }

    if (text.startsWith("/unban ")) {
      const toUnban = text.split(" ")[1];
      await unbanUser(toUnban);
      await msg.reply(`✅ ${toUnban} has been unbanned.`);
      return;
    }

    if (text === "/history") {
      const history = await getUserHistory(number);
      await msg.reply(`🕓 You have ${history.length} messages stored.`);
      return;
    }

    if (text.toLowerCase().startsWith("/pay")) {
      const parts = text.split(" ");
      const amount = parts[1];
      if (!amount) {
        await msg.reply("⚠️ Usage: /pay <amount>");
        return;
      }
      const phone = number.replace(/@.*$/, "");
      console.log("💰 Payment attempt:", phone, amount);
      try {
        const res = await stkPush(phone, amount);
        console.log("✅ STK push response:", res);
        await msg.reply("📲 Payment request sent. Check your phone to complete.");
      } catch (e) {
        console.error("❌ STK error:", e?.response?.data || e.message);
        await msg.reply("❌ Payment failed.");
      }
      return;
    }

    // fallback: GPT handler
    await saveUserMessage(number, "user", text);
    const reply = await handleMessage(number, text);
    await saveUserMessage(number, "bot", reply);
    await msg.reply(reply);

  } catch (err) {
    console.error("❌ message handler error:", err);
    try { await msg.reply("⚠️ Error handling message."); } catch (_) {}
  }
});

// start things
client.initialize();

client.on("loading_screen", (percent, message) => {
  console.log("⏳ Loading screen:", percent, message);
});

client.on("remote_session_saved", () => {
  console.log("💾 Remote session saved");
});

client.on("change_state", state => {
  console.log("🔄 Client state changed:", state);
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));

