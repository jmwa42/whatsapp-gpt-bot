import express from "express";
import qrcode from "qrcode";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

import pkg from "whatsapp-web.js";
import { chromium } from "playwright";

const { Client, LocalAuth } = pkg;

// ✅ Fix session storage
const baseAuthPath = process.env.WA_DATA_PATH || "/app/.wwebjs_auth";
fs.mkdirSync(baseAuthPath, { recursive: true });

// 🚀 Express server
const app = express();
let latestQR = null;

// ✅ WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: baseAuthPath }),
  puppeteer: {
    executablePath: chromium.executablePath(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-extensions",
    ],
  },
});

// QR route
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR code generated. Visit /qr to scan it.");
});

app.get("/qr", async (req, res) => {
  if (!latestQR) return res.send("<h2>No QR yet. Check logs.</h2>");
  const qrImg = await qrcode.toDataURL(latestQR);
  res.send(`<html><body style="text-align:center"><h2>Scan QR</h2><img src="${qrImg}"/></body></html>`);
});

// Events
client.on("authenticated", () => console.log("🔑 WhatsApp authenticated."));
client.on("ready", () => console.log("✅ WhatsApp client is ready!"));
client.on("disconnected", (r) => console.log("⚠️ Disconnected:", r));

client.on("message", async (msg) => {
  console.log("📩 Received:", msg.from, msg.body);
  if (msg.body.toLowerCase() === "ping") {
    await msg.reply("pong 🏓");
  }
});

// Start
client.initialize();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 HTTP server on http://localhost:${PORT} — /qr`));

