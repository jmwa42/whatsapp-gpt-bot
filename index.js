import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import axios from 'axios';
import expressLayouts from "express-ejs-layouts";


// local bot helpers (your existing modules)
import { handleMessage } from './bot/gpt.js';
import {
  saveUserMessage,
  isBanned,
  banUser,
  unbanUser,
  getUserHistory,
} from './bot/storage.js';
import { stkPush } from './bot/mpesa.js';


const { Client, LocalAuth } = pkg;

// --- paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VOLUME_DIR = process.env.SESSION_DIR || path.join(__dirname, '.wwebjs_auth');
const BOT_DATA_DIR = path.join(__dirname, 'bot');

// ensure directories exist
if (!fs.existsSync(BOT_DATA_DIR)) fs.mkdirSync(BOT_DATA_DIR, { recursive: true });
if (!fs.existsSync(VOLUME_DIR)) fs.mkdirSync(VOLUME_DIR, { recursive: true });

// Django backend base for fetching chat/payments (adjust in env)
const DJANGO_BASE = process.env.DJANGO_BASE || 'http://127.0.0.1:8000';

// express app
const app = express();
app.set("view engine", "ejs");
app.set("views", "./dashboard/views");
app.use(expressLayouts);
app.set("layout", "layout"); // default layout file: views/layout.ejs


// helper local-logging functions (for dashboard fallback)
function appendJson(file, obj) {
  let arr = [];
  try {
    if (fs.existsSync(file)) arr = JSON.parse(fs.readFileSync(file, 'utf8')) || [];
  } catch (e) {
    console.warn('Failed reading', file, e.message);
  }
  arr.push(obj);
  try {
    fs.writeFileSync(file, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error('Failed writing', file, e.message);
  }
}

function loadJson(file, defaultVal = []) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('loadJson failed:', file, e.message);
  }
  return defaultVal;
}

// ---------- WhatsApp client ----------
let latestQR = null;
let isClientReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: VOLUME_DIR }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
  takeoverOnConflict: true,
});

client.on('qr', (qr) => {
  latestQR = qr;
  console.log('📱 QR generated — visit /qr to scan');
});

client.on('ready', () => {
  isClientReady = true;
  console.log('✅ WhatsApp client ready');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth failure:', msg);
});

client.on('disconnected', (reason) => {
  isClientReady = false;
  console.warn('⚠️ WhatsApp disconnected:', reason);
});

// central message handler
client.on('message', async (msg) => {
  try {
    const number = msg.from;
    const text = (msg.body || '').trim();

    console.log('📩 Incoming:', number, text);

    // keep a local chat log for the dashboard fallback
    appendJson(path.join(BOT_DATA_DIR, 'chats.json'), {
      number,
      text,
      timestamp: new Date().toISOString(),
    });

    // ban check
    if (await isBanned(number)) {
      return msg.reply('🚫 You are banned from using this service.');
    }

    // admin commands (simple prefix approach)
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

    // payment command
    if (text.toLowerCase().startsWith('/pay')) {
      const parts = text.split(' ');
      const amount = parts[1];
      if (!amount) return msg.reply('⚠️ Usage: /pay <amount>');

      const phone = number.replace(/@.*$/, ''); // strip whatsapp domain part
      console.log('💰 Payment attempt:', phone, amount);

      try {
        const res = await stkPush(phone, amount);
        console.log('✅ STK push response', res);
        return msg.reply('📲 Payment request sent. Check your phone to complete.');
      } catch (err) {
        console.error('❌ M-Pesa error:', err?.response?.data || err?.message || err);
        return msg.reply('❌ Payment failed. Please try again later.');
      }
    }

    // default: forward to GPT handler
    await saveUserMessage(number, 'user', text);
    let reply = 'Sorry — an error occurred.';
    try {
      reply = await handleMessage(number, text);
    } catch (e) {
      console.error('GPT handler error:', e?.message || e);
    }
    await saveUserMessage(number, 'bot', reply);
    await msg.reply(reply);
  } catch (e) {
    console.error('message handler crashed:', e?.message || e);
  }
});

// expose a helper to send a single message (used by broadcast)
async function sendMessageTo(number, message) {
  const jid = number.includes('@') ? number : `${number}@c.us`;
  return client.sendMessage(jid, message);
}

// ---------- Express routes (dashboard + api) ----------

// simple health
app.get('/health', (req, res) => res.json({ ok: true }));

// home
app.get('/', (req, res) => {
  res.render('index');
});

// business editor (create file if missing)
app.get('/business', (req, res) => {
  const businessFile = path.join(BOT_DATA_DIR, 'business.json');
  let biz = { opening_hours: '', location: '', contact: '', price_list: {} };
  if (fs.existsSync(businessFile)) {
    try { biz = JSON.parse(fs.readFileSync(businessFile, 'utf8')); } catch (e) { console.warn('bad business.json, using defaults'); }
  } else {
    fs.writeFileSync(businessFile, JSON.stringify(biz, null, 2));
  }
  res.render('business', { biz });
});

app.post('/business', (req, res) => {
  const businessFile = path.join(BOT_DATA_DIR, 'business.json');
  const updated = {
    opening_hours: req.body.opening_hours || '',
    location: req.body.location || '',
    contact: req.body.contact || '',
    price_list: {},
  };

  const services = Array.isArray(req.body.services) ? req.body.services : (req.body.services ? [req.body.services] : []);
  const prices = Array.isArray(req.body.prices) ? req.body.prices : (req.body.prices ? [req.body.prices] : []);
  services.forEach((svc, i) => { if (svc) updated.price_list[svc] = prices[i] || ''; });

  fs.writeFileSync(businessFile, JSON.stringify(updated, null, 2));
  res.redirect('/business');
});

// QR page (auto-refresh client-side every 5s)
app.get('/qr', async (req, res) => {
  if (!latestQR) return res.send('<h2>No QR generated yet. Check back in a few seconds.</h2>');
  try {
    const qrImg = await qrcode.toDataURL(latestQR);
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp QR</title>
      <meta http-equiv="refresh" content="10"> <!-- auto refresh every 10s -->
      </head><body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;">
      <div style="text-align:center"><h3>Scan QR with WhatsApp (auto-refresh)</h3><img src="${qrImg}" style="max-width:90vw;max-height:80vh;"/></div></body></html>`);
  } catch (e) {
    console.error('QR render error', e?.message || e);
    res.status(500).send('Error generating QR');
  }
});

// Chat logs (try Django first, fallback to local file)
app.get('/chatlogs', async (req, res) => {
  try {
    const { data } = await axios.get(`${DJANGO_BASE}/api/chat/`, { timeout: 5000 });
    return res.render('chatlogs', { chats: data });
  } catch (e) {
    console.warn('Failed to fetch chat logs from Django, using local file:', e?.message || e);
    const chats = loadJson(path.join(BOT_DATA_DIR, 'chats.json'), []);
    return res.render('chatlogs', { chats });
  }
});

// Payments (Django primary, local fallback)
app.get('/payments', async (req, res) => {
  try {
    const { data } = await axios.get(`${DJANGO_BASE}/api/mpesa/payments/`, { timeout: 5000 });
    return res.render('payments', { payments: data });
  } catch (e) {
    console.warn('Failed to fetch payments from Django, using local file:', e?.message || e);
    const payments = loadJson(path.join(BOT_DATA_DIR, 'payments.json'), []);
    return res.render('payments', { payments });
  }
});

// Broadcast UI posts here; this route receives the form from dashboard
app.post('/broadcast', async (req, res) => {
  const message = req.body.message;
  const numbersRaw = req.body.numbers || ''; // optional comma-separated
  const numbers = numbersRaw ? numbersRaw.split(',').map(s => s.trim()).filter(Boolean) : null;

  if (!message) return res.status(400).send('Message is required');
  if (!isClientReady) return res.status(503).send('WhatsApp client not ready');

  let targets = numbers;
  if (!targets) {
    // try to load contacts.json or chats.json as poor-man's contact list
    const contactsFile = path.join(BOT_DATA_DIR, 'contacts.json');
    if (fs.existsSync(contactsFile)) {
      const contacts = loadJson(contactsFile, []);
      targets = contacts.map(c => c.number || c.phone).filter(Boolean);
    }
  }

  if (!targets || targets.length === 0) return res.status(400).send('No targets for broadcast');

  const results = [];
  for (const n of targets) {
    try {
      await sendMessageTo(n, message);
      results.push({ to: n, ok: true });
    } catch (e) {
      console.error('broadcast failed for', n, e?.message || e);
      results.push({ to: n, ok: false, error: e?.message || e });
    }
  }

  // record broadcast activity locally
  appendJson(path.join(BOT_DATA_DIR, 'broadcasts.json'), { message, targets, results, created_at: new Date().toISOString() });

  res.redirect('/broadcast');
});

// API endpoint used by dashboard to initiate broadcast programmatically (returns JSON)
app.post('/send-broadcast', async (req, res) => {
  const { message, numbers } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!isClientReady) return res.status(503).json({ error: 'whatsapp client not ready' });

  const targets = Array.isArray(numbers) && numbers.length ? numbers : loadJson(path.join(BOT_DATA_DIR, 'contacts.json'), []).map(c => c.number || c.phone).filter(Boolean);
  if (!targets || targets.length === 0) return res.status(400).json({ error: 'no targets' });

  const results = [];
  for (const n of targets) {
    try {
      await sendMessageTo(n, message);
      results.push({ to: n, ok: true });
    } catch (e) {
      results.push({ to: n, ok: false, error: e?.message || e });
    }
  }

  appendJson(path.join(BOT_DATA_DIR, 'broadcasts.json'), { message, targets, results, created_at: new Date().toISOString() });
  res.json({ ok: true, results });
});

// start everything
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    client.initialize();

    app.listen(PORT, () => {
      console.log(`🌍 Dashboard + Bot running on http://localhost:${PORT} (PORT env: ${process.env.PORT || 'not set'})`);
    });
  } catch (e) {
    console.error('Failed to start app:', e?.message || e);
    process.exit(1);
  }
})();

