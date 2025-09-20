import express from "express";
import fs from "fs";
import bodyParser from "body-parser";
import qrcode from "qrcode";
import pkg from "whatsapp-web.js";
import dotenv from "dotenv";

dotenv.config();

const { Client, LocalAuth } = pkg;

import { handleMessage } from "./bot/gpt.js";
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory
} from "./bot/storage.js";
import { stkPush } from "./bot/mpesa.js";

const app = express();
app.set("view engine", "ejs");
app.set("views", "./dashboard/views");
app.use(bodyParser.urlencoded({ extended: true }));

// ====================
// Dashboard routes
// ====================
app.get("/", (req, res) => {
  res.send(
    `<h2>Dashboard</h2>
     <ul>
       <li><a href="/business">Edit Business Info</a></li>
       <li><a href="/qr">WhatsApp QR</a></li>
     </ul>`
  );
});

app.get("/business", (req, res) => {
  let biz = {
    opening_hours: "",
    location: "",
    contact: "",
    price_list: {}
  };

  try {
    if (fs.existsSync("./bot/business.json")) {
      biz = JSON.parse(fs.readFileSync("./bot/business.json", "utf8"));
    } else {
      fs.mkdirSync("./bot", { recursive: true });
      fs.writeFileSync("./bot/business.json", JSON.stringify(biz, null, 2));
    }
  } catch (err) {
    console.error("❌ Error loading business.json:", err);
  }

  res.render("business", { biz });
});



// ====================
// WhatsApp bot setup
// ====================
let latestQR = null;

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] }
});

client.on("qr", (qr) => {
  latestQR = qr;
  console.log("📱 QR code generated. Visit /qr to scan.");
});

app.get("/qr", async (req, res) => {
  if (!latestQR) {
    return res.send("<h2>No QR generated yet. Check back in a few seconds.</h2>");
  }
  try {
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
  } catch (err) {
    res.status(500).send("Error generating QR");
  }
});

client.on("ready", () => {
  console.log("✅ WhatsApp client is ready!");
});

client.on("message", async (msg) => {
  const number = msg.from;
  const text = msg.body.trim();

  console.log("📩 Incoming:", number, text);

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

    if (!amount) {
      return msg.reply("⚠️ Usage: /pay <amount>");
    }

    const phone = number.replace("@c.us", "");

    console.log("💰 Payment attempt:", phone, amount);

    try {
      const res = await stkPush(phone, amount);
      console.log("✅ Safaricom response:", res.data || res);
      return msg.reply("📲 Payment request sent. Check your phone.");
    } catch (err) {
      console.error("❌ M-Pesa error:", err.response?.data || err.message);
      return msg.reply("❌ Payment failed. Please try again later.");
    }
  }

  await saveUserMessage(number, "user", text);
  const reply = await handleMessage(number, text);
  await saveUserMessage(number, "bot", reply);

  msg.reply(reply);
});

client.initialize();

// ====================
// Start server
// ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Dashboard + Bot running on http://localhost:${PORT}`);
});

