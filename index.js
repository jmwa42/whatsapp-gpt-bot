import express from "express";
import qrcode from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";

const app = express();
const PORT = process.env.PORT || 8080;

// ✅ WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth"
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  },
});

// 📱 Log QR in terminal
client.on("qr", qr => {
  console.log("📱 Scan QR:");
  qrcode.generate(qr, { small: true });
});

// 🔑 Logged in but not yet ready
client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
});

// ✅ Ready event
client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

// ⏳ Extra debug events
client.on("loading_screen", (percent, msg) => {
  console.log(`⏳ Loading: ${percent}% - ${msg}`);
});

client.on("change_state", state => {
  console.log("🔄 State:", state);
});

client.on("disconnected", reason => {
  console.log("⚠️ Disconnected:", reason);
});

// 📩 Simple message handler
client.on("message", async msg => {
  console.log("💬 Message received:", msg.body);
  if (msg.body.toLowerCase() === "ping") {
    await msg.reply("pong");
  }
});

// 🚀 Start WhatsApp client
client.initialize();

// 🌍 Express routes
app.get("/", (req, res) => {
  res.send("✅ WhatsApp Bot running. Use /qr to scan.");
});

app.get("/qr", (req, res) => {
  res.send("Check terminal for QR code.");
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on http://localhost:${PORT}`);
});

