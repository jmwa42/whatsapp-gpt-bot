// index.js
const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 8080;

let latestQR = null;

// --- WhatsApp Client ---
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "/app/.wwebjs_auth", // persist sessions in container volume
  }),
  puppeteer: {
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: (
      process.env.PUPPETEER_ARGS ||
      "--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage"
    ).split(" "),
    headless: true,
  },
});

// --- WhatsApp Events ---
client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR RECEIVED (also available at /qr)");
  qrcode.generate(qr, { small: true });
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

// --- Diagnostic watchdog (optional) ---
setTimeout(() => {
  if (!client.info) {
    console.error(
      "❌ READY DID NOT FIRE within 30s after AUTH. Check Chromium logs."
    );
  }
}, 30000);

