// index.js (ESM version)
import express from "express";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";

const app = express();
const PORT = process.env.PORT || 8080;

let latestQR = null;

// --- WhatsApp Client ---
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "/app/.wwebjs_auth",
  }),
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

// --- WhatsApp Events ---
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR RECEIVED (also available at /qr)");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ AUTH FAILURE", msg);
});

client.on("disconnected", (reason) => {
  console.log("❌ Client disconnected", reason);
});

client.initialize();

// --- Express server for QR ---
app.get("/qr", async (req, res) => {
  if (!latestQR) {
    return res.status(404).send("No QR yet, check back shortly...");
  }
  try {
    const qrImage = await QRCode.toDataURL(latestQR);
    res.send(`
      <html>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;">
          <h2>Scan QR with WhatsApp</h2>
          <img src="${qrImage}" />
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send("Error generating QR");
  }
});

app.get("/", (req, res) => {
  res.send("✅ WhatsApp bot is running. Visit /qr to scan login QR.");
});

app.listen(PORT, () => {
  console.log(`🌍 HTTP server on port ${PORT} — /qr`);
});

// --- Diagnostic watchdog ---
setTimeout(() => {
  if (!client.info) {
    console.error(
      "❌ READY DID NOT FIRE within 30s after AUTH. Check Chromium logs."
    );
  }
}, 30000);

