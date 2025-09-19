import express from "express";
import qrcode from "qrcode";
import pkg from "whatsapp-web.js";
import dotenv from "dotenv";

dotenv.config();

const { Client, LocalAuth } = pkg;

const app = express();
const PORT = process.env.PORT || 8080;

let qrCodeData = null;

// WhatsApp client with persistent auth
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./.wwebjs_auth",
  }),
  puppeteer: {
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

// QR handler
client.on("qr", async (qr) => {
  console.log("📱 QR code generated.");
  qrCodeData = await qrcode.toDataURL(qr);
});

// Authenticated
client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
});

// Ready
client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

// Message handler
client.on("message", async (message) => {
  console.log("💬 Message received:", message.body);

  if (message.body.toLowerCase() === "hi") {
    await message.reply("👋 Hello! How can I help you today?");
  } else if (message.body.toLowerCase() === "status") {
    await message.reply("✅ Bot is running fine on Railway!");
  } else {
    // Default echo
    await message.reply(`You said: ${message.body}`);
  }

  // 🔗 Example hook: forward to backend API
  // try {
  //   await fetch("http://django-backend:8000/api/messages/", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ from: message.from, text: message.body }),
  //   });
  // } catch (err) {
  //   console.error("❌ Failed to forward to backend:", err.message);
  // }
});

// Express endpoint to show QR
app.get("/qr", (req, res) => {
  if (qrCodeData) {
    res.send(`<img src="${qrCodeData}" />`);
  } else {
    res.send("❌ QR not yet generated, check logs.");
  }
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on http://localhost:${PORT}`);
});

// Start WhatsApp client
client.initialize();

