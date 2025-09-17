// diagnostic-index.js
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

const { Client, LocalAuth } = pkg;
const app = express();

const PORT = process.env.PORT || 8080;
const AUTH_PARENT = process.env.WA_DATA_PATH || "/app/.wwebjs_auth"; // use the same path you mounted

// ensure folder exists
try {
  fs.mkdirSync(AUTH_PARENT, { recursive: true });
  console.log("✅ Ensured WA_PATH exists:", AUTH_PARENT);
} catch (e) {
  console.error("⚠️ Could not ensure auth folder:", e.message);
}

// create client with explicit executable path and logging-friendly args
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: AUTH_PARENT }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: false,   // ⬅️ force visible browser, needed on some servers
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--disable-gpu",
      "--no-zygote",
      "--disable-accelerated-2d-canvas",
      "--disable-web-security",
      "--window-size=1920,1080",
      "--remote-debugging-port=9222"
    ],
  },
});


// event logging
client.on("qr", qr => {
  latestQR = qr;
  console.log("📱 QR generated — visit /qr to scan (no QR dumped to logs).");
});

client.on("authenticated", () => {
  console.log("🔑 WhatsApp authenticated.");
  // start readiness watchdog (30s)
  startReadyWatchdog();
});

client.on("auth_failure", msg => console.error("❌ auth_failure:", msg));
client.on("ready", () => {
  readyFired = true;
  console.log("✅ WhatsApp client is READY!");
});
client.on("loading_screen", (pct, msg) => console.log("⏳ loading_screen:", pct, msg));
client.on("change_state", state => console.log("🔄 change_state:", state));
client.on("disconnected", reason => console.log("⚠️ disconnected:", reason));
client.on("remote_session_saved", () => console.log("💾 remote_session_saved"));

// message handler (simple)
client.on("message", async msg => {
  try {
    console.log("📩 incoming:", msg.from, msg.body);
    if ((msg.body || "").toLowerCase() === "ping") {
      await msg.reply("pong 🏓");
      return;
    }
    // keep minimal for now
    await msg.reply("I got your message (debug).");
  } catch (err) {
    console.error("❌ message handler error:", err?.message || err);
  }
});

// /qr route (serves image)
let latestQR = null;
app.get("/qr", async (req, res) => {
  if (!latestQR) return res.send("<h3>No QR yet — check logs for 'QR generated'.</h3>");
  try {
    const src = await qrcode.toDataURL(latestQR);
    return res.send(`<img src="${src}" />`);
  } catch (e) {
    return res.status(500).send("QR error: " + e.message);
  }
});

// diagnostic helpers
let readyFired = false;
let watchdogTimer = null;

function startReadyWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer);
  watchdogTimer = setTimeout(() => {
    if (!readyFired) {
      console.error("❌ READY DID NOT FIRE within 30s after AUTH. Dumping diagnostics...");
      try {
        const list = fs.existsSync(AUTH_PARENT) ? fs.readdirSync(AUTH_PARENT) : [];
        console.log("Auth parent contents:", list);
        list.forEach(name => {
          try {
            const p = path.join(AUTH_PARENT, name);
            const s = fs.statSync(p);
            console.log(" -", name, "mode", (s.mode & 0o777).toString(8), "uid", s.uid, "gid", s.gid, "size", s.size);
            if (s.isDirectory()) {
              const nested = fs.readdirSync(p).slice(0,50);
              console.log("   nested:", nested);
            }
          } catch (e) { console.log("   stat failed for", name, e.message); }
        });
      } catch (e) {
        console.error("Could not list auth folder:", e.message);
      }
      // Print reminder to check chromium logs & DEBUG env
      console.log("🔎 Next: enable DEBUG=wwebjs* env, check Chromium errors in logs (Failed to launch...).");
    } else {
      console.log("✅ Ready fired within watchdog window.");
    }
  }, 30000);
}

// global process error printing
process.on("unhandledRejection", (r) => console.error("unhandledRejection:", r));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

client.initialize().catch(e => console.error("client.initialize() failed:", e?.message || e));

app.listen(PORT, () => console.log(`🌍 HTTP server on port ${PORT} — /qr`));

