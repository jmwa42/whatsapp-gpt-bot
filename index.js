import express from "express";
import qrcode from "qrcode";
import pkg from "whatsapp-web.js";

const { Client, LocalAuth } = pkg;

const app = express();
const PORT = process.env.PORT || 8080;

let qrCodeData = null;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./.wwebjs_auth" }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
      "--disable-gpu",
    ],
  },
});

client.on("qr", (qr) => {
  console.log("📱 QR code generated.");
  qrCodeData = qr;
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
});

client.on("disconnected", (reason) => {
  console.error("❌ WhatsApp disconnected:", reason);
});

client.on("message", async (msg) => {
  console.log("💬 Message received:", msg.body);
  if (msg.body.toLowerCase() === "ping") {
    await msg.reply("pong 🏓");
  }
});

// Express routes
app.get("/", (req, res) => {
  res.send("✅ WhatsApp bot server is running.");
});

app.get("/qr", async (req, res) => {
  if (!qrCodeData) {
    return res.status(404).send("QR not generated yet.");
  }
  const qrImage = await qrcode.toDataURL(qrCodeData);
  res.send(`<img src="${qrImage}" />`);
});

app.listen(PORT, () => {
  console.log(`🌍 HTTP server on port ${PORT} — /qr`);
});

// Initialize WhatsApp
client.initialize().catch((err) => {
  console.error("client.initialize() failed:", err);
});

