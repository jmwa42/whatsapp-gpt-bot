import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
dotenv.config();

import { handleMessage } from './bot/gpt.js';
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory
} from './bot/storage.js';
import { stkPush } from './bot/mpesa.js'; 

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

  // 💰 Payment
if (text.toLowerCase().startsWith('/pay')) {
  const parts = text.split(' ');
  const amount = parts[1];

  if (!amount) {
    return msg.reply("⚠️ Usage: /pay <amount>");
  }

  const phone = number.replace('@c.us', '').replace('@c.ke', ''); 

  console.log("💰 Payment attempt:", phone, amount);

  try {
    const res = await stkPush(phone, amount);
    console.log("✅ Safaricom response:", res.data || res);

    return msg.reply("📲 Payment request sent. Check your phone to complete.");
  } catch (err) {
    console.error("❌ M-Pesa error:", err.response?.data || err.message);
    return msg.reply("❌ Payment failed. Please try again later.");
  }
}


  // 🤖 GPT (default fallback)
  await saveUserMessage(number, 'user', text);
  const reply = await handleMessage(number, text);
  await saveUserMessage(number, 'bot', reply);

  msg.reply(reply);
});

client.initialize();
