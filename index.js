// index.js
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import fs from "fs";
import bodyParser from "body-parser";
import axios from "axios";
import path from "path";

import { handleMessage } from './bot/gpt.js';
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory
} from './bot/storage.js';
import { stkPush } from './bot/mpesa.js'; 

const app = express();
const PORT = process.env.PORT || 3000;
const { Client, LocalAuth } = pkg;

// ✅ WhatsApp client setup
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "/app/.wwebjs_auth" }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  }
});

// Show QR only once if no session is saved
client.on("qr", qr => {
  qrcode.generate(qr, { small: true });
  console.log("📱 Scan this QR with WhatsApp");
});

client.on("ready", () => {
  console.log("✅ WhatsApp bot is ready!");
});

client.on("auth_failure", msg => {
  console.error("❌ Auth failure:", msg);
});

// ✅ Main message handler
client.on('message', async (msg) => {
  const number = msg.from;
  const text = msg.body.trim();

  console.log("📩 Incoming:", number, text);

  // 🚫 Block banned users
  if (await isBanned(number)) {
    return msg.reply('🚫 You are banned from using this service.');
  }

  // 🛠️ Admin commands
  if (text.startsWith('/ban ')) {
    const toBan = text.split(' ')[1];
    await banUser(toBan);
    return msg.reply(`🚫 ${toBan} has been banned.`);
  }

  if (text.startsWith('/unban ')) {
    const toUnban = text.split(' ')[1];
    await unbanUser(toUnban);
    return msg.reply(`✅ ${toUnban} has been unbanned.`);
  }

  if (text === '/history') {
    const history = await getUserHistory(number);
    return msg.reply(`🕓 You have ${history.length} messages stored.`);
  }



// Django backend base
const DJANGO_BASE = process.env.DJANGO_BASE || "http://127.0.0.1:8000";

app.set("view engine", "ejs");
app.set("views", "./dashboard/views");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// 🏠 Home
app.get("/", (req, res) => {
  res.render("index");
});

// 🏢 Business Info
app.get("/business", (req, res) => {
  let biz = { opening_hours: "", location: "", contact: "", price_list: {} };
  try {
    biz = JSON.parse(fs.readFileSync("./bot/business.json", "utf8"));
  } catch (err) {
    console.warn("⚠️ No business.json yet, using defaults");
  }
  res.render("business", { biz });
});

app.post("/business", (req, res) => {
  const updated = {
    opening_hours: req.body.opening_hours,
    location: req.body.location,
    contact: req.body.contact,
    price_list: {},
  };
  req.body.services?.forEach((svc, i) => {
    if (svc) updated.price_list[svc] = req.body.prices[i] || "";
  });
  fs.writeFileSync("./bot/business.json", JSON.stringify(updated, null, 2));
  res.redirect("/business");
});

// 💬 Chat Logs
app.get("/chatlogs", async (req, res) => {
  try {
    const { data } = await axios.get(`${DJANGO_BASE}/api/chat/`);
    res.render("chatlogs", { chats: data });
  } catch (e) {
    res.send("⚠️ Failed to load chat logs: " + e.message);
  }
});

// 💰 Payments
app.get("/payments", async (req, res) => {
  try {
    const { data } = await axios.get(`${DJANGO_BASE}/api/mpesa/payments/`);
    res.render("payments", { payments: data });
  } catch (e) {
    res.send("⚠️ Failed to load payments: " + e.message);
  }
});

// 📢 Broadcast
app.get("/broadcast", (req, res) => {
  res.render("broadcast");
});

app.post("/broadcast", async (req, res) => {
  try {
    await axios.post("http://localhost:3000/send-broadcast", {
      message: req.body.message,
    });
    res.redirect("/broadcast");
  } catch (e) {
    res.send("⚠️ Failed to broadcast: " + e.message);
  }
});

app.listen(PORT, () =>
  console.log(`🌐 Dashboard running at http://localhost:${PORT}`)
);

