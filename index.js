// index.js — combined WhatsApp bot + dashboard (complete, ready)
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

// init local JSON files so routes don’t crash
const filesToInit = [
  "business.json",
  "chats.json",
  "payments.json",
  "contacts.json",
  "broadcasts.json",
  "faqs.json",
  "fees.json",
  "activities.json",
  "transport.json",
  "meta.json"
];
for (const f of filesToInit) {
  const file = path.join(BOT_DATA_DIR, f);
  if (!fs.existsSync(file)) {
    let initData = "[]";
    if (f === "business.json") initData = "{}";
    if (f === "fees.json" || f === "activities.json" || f === "meta.json") initData = "{}";
    // default for faqs -> [], fees -> {}, activities -> {}, meta -> {}
    if (f === "faqs.json") initData = "[]";
    if (f === "payments.json") initData = "[]";
    fs.writeFileSync(file, initData);
  }
}

// Django backend base for fetching chat/payments (optional)
const DJANGO_BASE = process.env.DJANGO_BASE || 'http://127.0.0.1:8000';

// express app
const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "dashboard/views"));
app.use(expressLayouts);
app.set("layout", "layout");

// body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- helper utilities ----------
function readFileSafe(filename, fallback) {
  try {
    const file = path.join(BOT_DATA_DIR, filename);
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn("readFileSafe error", filename, e.message);
    return fallback;
  }
}
function writeFileSafe(filename, obj) {
  try {
    fs.writeFileSync(path.join(BOT_DATA_DIR, filename), JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    console.error("writeFileSafe error", filename, e.message);
    return false;
  }
}
function appendJson(filename, item) {
  const arr = readFileSafe(filename, []);
  arr.push(item);
  writeFileSafe(filename, arr);
}

// meta helper
function updateMetaTimestamp() {
  const meta = readFileSafe("meta.json", {});
  meta.last_updated = new Date().toISOString();
  writeFileSafe("meta.json", meta);
}

// payment helpers
function savePayment(paymentObj) {
  const payments = readFileSafe("payments.json", []);
  // if it has checkout_request_id try update existing
  if (paymentObj.checkout_request_id) {
    const idx = payments.findIndex(p => p.checkout_request_id === paymentObj.checkout_request_id);
    if (idx !== -1) {
      payments[idx] = { ...payments[idx], ...paymentObj };
      writeFileSafe("payments.json", payments);
      return payments[idx];
    }
  }
  payments.push(paymentObj);
  writeFileSafe("payments.json", payments);
  return paymentObj;
}

// small tokenizer helper for FAQ matching
function tokens(s) {
  if (!s) return [];
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function faqMatches(text, question) {
  const t = tokens(text);
  const q = tokens(question);
  if (q.length === 0 || t.length === 0) return false;
  // match if >=2 overlapping tokens OR entire question substring found
  const setT = new Set(t);
  const overlap = q.filter(w => setT.has(w)).length;
  if (overlap >= Math.min(2, q.length)) return true;
  return text.toLowerCase().includes(question.toLowerCase().slice(0, Math.max(6, Math.floor(question.length/3))));
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
  // also persist the raw QR so dashboard can show it (optional)
  try { writeFileSafe("qr.json", { qr }); } catch (e) {}
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

// send message helper (normalize)
async function sendMessageTo(number, message) {
  const jid = number.includes('@') ? number : `${number}@c.us`;
  return client.sendMessage(jid, message);
}

//.........transport fees........

function findTransportFee(message) {
  if (!fs.existsSync(transportFile)) return null;
  const fees = JSON.parse(fs.readFileSync(transportFile, "utf-8"));

  const text = message.toLowerCase();

  for (let fee of fees) {
    const route = fee.route.toLowerCase();
    const courts = fee.courts.toLowerCase().split(",").map(c => c.trim());

    if (text.includes(route)) {
      for (let court of courts) {
        if (text.includes(court)) {
          return `🚍 Transport for ${fee.route} (court ${court}) is Ksh. ${fee.fee}`;
        }
      }
    }
  }
  return null;
}


// ---------- Message handling ----------
client.on('message', async (msg) => {
  try {
    const number = msg.from;
    const textRaw = msg.body || '';
    const text = textRaw.trim();

    console.log('📩 Incoming:', number, text);
    
    // 1. Try Transport Fee first
  let reply = findTransportFee(message);

  // 2. Fall back to FAQ, fees, activities, or AI
  if (!reply) {
    reply = await handleSmartReply(message, from); 
  }

  // Send back to WhatsApp
  await sendMessage(from, reply);

  res.sendStatus(200);

    // store incoming to local chats.json (standardized shape)
    appendJson("chats.json", { number, from: 'user', text, timestamp: new Date().toISOString() });

    // lowdb conversation storage (existing)
    await saveUserMessage(number, 'user', text);

    // ban check
    if (await isBanned(number)) {
      await msg.reply('🚫 You are banned from using this service.');
      return;
    }

    // admin commands
    if (text.startsWith('/ban ')) {
      const toBan = text.split(' ')[1];
      await banUser(toBan);
      await msg.reply(`🚫 ${toBan} has been banned.`);
      return;
    }
    if (text.startsWith('/unban ')) {
      const toUnban = text.split(' ')[1];
      await unbanUser(toUnban);
      await msg.reply(`✅ ${toUnban} has been unbanned.`);
      return;
    }
    if (text === '/history') {
      const history = await getUserHistory(number);
      await msg.reply(`🕓 You have ${history.length} messages stored.`);
      return;
    }

    // payment command
    if (text.toLowerCase().startsWith('/pay')) {
      const parts = text.split(' ');
      const amount = parts[1];
      if (!amount) {
        await msg.reply('⚠️ Usage: /pay <amount>');
        return;
      }
      const phone = number.replace(/@.*$/, '');
      console.log('💰 Payment attempt:', phone, amount);

      try {
        const darajaResp = await stkPush(phone, amount);
        // darajaResp may be object; adapt to what stkPush returns
        await msg.reply('📲 Payment request sent. Check your phone to complete.');
        // also register initiation in local payments.json (if stkPush returns checkout ids)
        const toSave = {
          merchant_request_id: darajaResp?.MerchantRequestID || darajaResp?.merchantRequestId || null,
          checkout_request_id: darajaResp?.CheckoutRequestID || darajaResp?.checkoutRequestId || null,
          phone,
          amount,
          status: 'initiated',
          created_at: new Date().toISOString(),
          raw_response: darajaResp || {}
        };
        savePayment(toSave);
      } catch (err) {
        console.error('❌ M-Pesa error:', err?.response?.data || err?.message || err);
        await msg.reply('❌ Payment failed. Please try again later.');
      }
      return;
    }

    // ---------- SCHOOL-SPECIFIC DATA RESPONSES ----------
    // load fresh copies on each message
    const faqs = readFileSafe("faqs.json", []);
    const fees = readFileSafe("fees.json", {});
    const activities = readFileSafe("activities.json", {});
    const meta = readFileSafe("meta.json", { last_updated: null });

    // 1) FAQ matching (fuzzy token match)
    for (const f of faqs) {
      const q = f.question || f.q || '';
      const a = f.answer || f.a || '';
      if (!q) continue;
      if (faqMatches(text, q)) {
        const replyText = `✅ ${a}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
        await msg.reply(replyText);
        appendJson("chats.json", { number, from: 'bot', text: replyText, timestamp: new Date().toISOString() });
        await saveUserMessage(number, 'bot', replyText);
        return;
      }
    }

    // 2) Fees — try to find a class in text
    const lowered = text.toLowerCase();
    let feeMatched = null;
    for (const cls of Object.keys(fees || {})) {
      const clsLower = cls.toLowerCase();
      if (lowered.includes(clsLower) || lowered.includes(clsLower.replace(/\s+/g, ''))) {
        feeMatched = { cls, amount: fees[cls] };
        break;
      }
      // try numeric match: if cls contains a number and text contains that number
      const digits = cls.match(/\d+/);
      if (digits && lowered.includes(digits[0])) {
        feeMatched = { cls, amount: fees[cls] };
        break;
      }
    }
    if (feeMatched) {
      const replyText = `💰 Fees for ${feeMatched.cls}: ${feeMatched.amount}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
      await msg.reply(replyText);
      appendJson("chats.json", { number, from: 'bot', text: replyText, timestamp: new Date().toISOString() });
      await saveUserMessage(number, 'bot', replyText);
      return;
    } else if (lowered.includes('fee') || lowered.includes('fees')) {
      // general fees summary
      const summary = Object.entries(fees || {}).map(([k,v]) => `${k}: ${v}`).join('\n') || 'No fees set.';
      const replyText = `💰 School Fees:\n${summary}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
      await msg.reply(replyText);
      appendJson("chats.json", { number, from: 'bot', text: replyText, timestamp: new Date().toISOString() });
      await saveUserMessage(number, 'bot', replyText);
      return;
    }
    
    // ------------------ Transport Fees ------------------
app.get("/transport", (req, res) => {
  const file = path.join(BOT_DATA_DIR, "transport.json");
  let transport = [];
  if (fs.existsSync(file)) {
    try { transport = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }
  res.render("transport", { transport });
});

app.post("/transport", (req, res) => {
  const file = path.join(BOT_DATA_DIR, "transport.json");
  let transport = [];
  if (fs.existsSync(file)) {
    try { transport = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  }

  transport.push({
    route: req.body.route,
    amount: req.body.amount,
  });

  fs.writeFileSync(file, JSON.stringify(transport, null, 2));
  res.redirect("/transport");
});




    // 3) Activities match with friendly keywords
    const activityKeywords = {
      opening_date: ['opening','open','start','starts','school opens'],
      closing_date: ['closing','close','ends','end','school closes'],
      parents_meeting: ['parents', 'parents meeting', 'parents meeting date'],
      school_trip: ['trip', 'school trip', 'trip date'],
      exams_start: ['exam', 'exams', 'exams start'],
    };
    for (const [k, keywords] of Object.entries(activityKeywords)) {
      for (const kw of keywords) {
        if (lowered.includes(kw)) {
          const val = activities[k] || 'Not set';
          const replyText = `📅 ${k.replace(/_/g,' ')}: ${val}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
          await msg.reply(replyText);
          appendJson("chats.json", { number, from: 'bot', text: replyText, timestamp: new Date().toISOString() });
          await saveUserMessage(number, 'bot', replyText);
          return;
        }
      }
    }

    // ---------- GPT fallback ----------
    try {
      const reply = await handleMessage(number, text);
      // store bot reply and send
      await saveUserMessage(number, 'bot', reply);
      appendJson("chats.json", { number, from: 'bot', text: reply, timestamp: new Date().toISOString() });
      await msg.reply(reply);
    } catch (err) {
      console.error('GPT error', err?.message || err);
      const fallback = "❌ Sorry, something went wrong. Please try again later.";
      appendJson("chats.json", { number, from: 'bot', text: fallback, timestamp: new Date().toISOString() });
      await msg.reply(fallback);
    }

  } catch (e) {
    console.error('message handler crashed:', e?.message || e);
  }
});

// ---------- Express routes (dashboard + API) ----------

// health
app.get('/health', (req, res) => res.json({ ok: true }));

// home
app.get('/', (req, res) => {
  res.render('index');
});

// Business editor
app.get('/business', (req, res) => {
  const businessFile = path.join(BOT_DATA_DIR, 'business.json');
  let biz = { opening_hours: '', location: '', contact: '', price_list: {} };
  if (fs.existsSync(businessFile)) {
    try { biz = JSON.parse(fs.readFileSync(businessFile, 'utf8')); } catch (e) {}
  }
  res.render('business', { biz, lastUpdated: readFileSafe("meta.json", {}).last_updated || null });
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
  writeFileSafe("business.json", updated);
  updateMetaTimestamp();
  res.redirect('/business');
});

// QR page
app.get('/qr', async (req, res) => {
  if (!latestQR) return res.send('<h2>No QR generated yet. Check back soon.</h2>');
  try {
    const qrImg = await qrcode.toDataURL(latestQR);
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp QR</title>
      <meta http-equiv="refresh" content="10">
      </head><body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;">
      <div style="text-align:center"><h3>Scan QR with WhatsApp</h3><img src="${qrImg}" style="max-width:90vw;max-height:80vh;"/></div></body></html>`);
  } catch (e) {
    console.error('QR render error', e?.message || e);
    res.status(500).send('Error generating QR');
  }
});

// Chat logs (try Django first, fallback to local)
app.get('/chatlogs', async (req, res) => {
  try {
    const { data } = await axios.get(`${DJANGO_BASE}/api/chat/`, { timeout: 5000 });
    // expect data to be array of {number, from, text, timestamp}
    return res.render('chatlogs', { chats: data });
  } catch (e) {
    const chats = readFileSafe("chats.json", []);
    return res.render('chatlogs', { chats });
  }
});

// Payments page (Django primary, fallback local)
app.get('/payments', async (req, res) => {
  try {
    const { data } = await axios.get(`${DJANGO_BASE}/api/mpesa/payments/`, { timeout: 5000 });
    return res.render('payments', { payments: data });
  } catch (e) {
    const payments = readFileSafe("payments.json", []);
    return res.render('payments', { payments });
  }
});

// --------- FAQ / Fees / Activities routes ----------

// FAQs
app.get('/faqs', (req, res) => {
  const faqs = readFileSafe("faqs.json", []);
  const lastUpdated = readFileSafe("meta.json", {}).last_updated || null;
  res.render('faqs', { faqs, lastUpdated });
});
app.post('/faqs', (req, res) => {
  const faqs = readFileSafe("faqs.json", []);
  const question = req.body.question?.trim();
  const answer = req.body.answer?.trim();
  if (question && answer) {
    faqs.push({ question, answer });
    writeFileSafe("faqs.json", faqs);
    updateMetaTimestamp();
  }
  res.redirect('/faqs');
});

// Fees
app.get('/fees', (req, res) => {
  const fees = readFileSafe("fees.json", {});
  const lastUpdated = readFileSafe("meta.json", {}).last_updated || null;
  res.render('fees', { fees, lastUpdated });
});
app.post('/fees', (req, res) => {
  const updated = {};
  const classes = Array.isArray(req.body.classes) ? req.body.classes : (req.body.classes ? [req.body.classes] : []);
  const amounts = Array.isArray(req.body.amounts) ? req.body.amounts : (req.body.amounts ? [req.body.amounts] : []);
  classes.forEach((cls, i) => { if (cls) updated[cls] = amounts[i] || ''; });
  writeFileSafe("fees.json", updated);
  updateMetaTimestamp();
  res.redirect('/fees');
});

// Activities
app.get('/activities', (req, res) => {
  const activities = readFileSafe("activities.json", {});
  const lastUpdated = readFileSafe("meta.json", {}).last_updated || null;
  res.render('activities', { activities, lastUpdated });
});
app.post('/activities', (req, res) => {
  const updated = {
    opening_date: req.body.opening_date || '',
    closing_date: req.body.closing_date || '',
    parents_meeting: req.body.parents_meeting || '',
    school_trip: req.body.school_trip || '',
    exams_start: req.body.exams_start || ''
  };
  writeFileSafe("activities.json", updated);
  updateMetaTimestamp();
  res.redirect('/activities');
});

// Broadcast (form)
app.post('/broadcast', async (req, res) => {
  const message = req.body.message;
  const numbersRaw = req.body.numbers || '';
  const numbers = numbersRaw ? numbersRaw.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (!message) return res.status(400).send('Message is required');
  if (!isClientReady) return res.status(503).send('WhatsApp not ready');
  let targets = numbers;
  if (!targets) {
    const contacts = readFileSafe("contacts.json", []);
    targets = (contacts || []).map(c => c.number || c.phone).filter(Boolean);
  }
  if (!targets || targets.length === 0) return res.status(400).send('No targets for broadcast');
  const results = [];
  for (const n of targets) {
    try { await sendMessageTo(n, message); results.push({ to: n, ok: true }); }
    catch (e) { results.push({ to: n, ok: false, error: e?.message || e }); }
  }
  appendJson("broadcasts.json", { message, targets, results, created_at: new Date().toISOString() });
  res.redirect('/broadcast');
});

// API broadcast (JSON)
app.post('/send-broadcast', async (req, res) => {
  const { message, numbers } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!isClientReady) return res.status(503).json({ error: 'whatsapp not ready' });
  const targets = Array.isArray(numbers) && numbers.length ? numbers : (readFileSafe("contacts.json", [])).map(c => c.number || c.phone).filter(Boolean);
  if (!targets || targets.length === 0) return res.status(400).json({ error: 'no targets' });
  const results = [];
  for (const n of targets) {
    try { await sendMessageTo(n, message); results.push({ to: n, ok: true }); }
    catch (e) { results.push({ to: n, ok: false, error: e?.message || e }); }
  }
  appendJson("broadcasts.json", { message, targets, results, created_at: new Date().toISOString() });
  res.json({ ok: true, results });
});

// ---------- MPESA endpoints for dashboard (register-init & callback) ----------
app.post('/api/mpesa/register-init', (req, res) => {
  // expected: { MerchantRequestID, CheckoutRequestID, PhoneNumber, Amount }
  try {
    const body = req.body || {};
    const record = {
      merchant_request_id: body.MerchantRequestID || body.merchant_request_id || null,
      checkout_request_id: body.CheckoutRequestID || body.checkout_request_id || null,
      phone: body.PhoneNumber || body.phone || null,
      amount: body.Amount || body.amount || null,
      status: 'initiated',
      created_at: new Date().toISOString(),
      raw_request: body
    };
    savePayment(record);
    console.log("📌 register-init received and saved:", record.checkout_request_id || record.merchant_request_id);
    return res.json({ ok: true, created: true, id: record.checkout_request_id || null });
  } catch (e) {
    console.error('register-init error', e.message || e);
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/mpesa/callback', (req, res) => {
  // Safaricom callback structure contains Body.stkCallback
  try {
    const body = req.body || {};
    console.log("🔔 M-Pesa Callback Body:", body?.Body || body);
    const stk = (body.Body && body.Body.stkCallback) ? body.Body.stkCallback : null;
    if (!stk) {
      // allow generic payloads (for manual tests)
      const fallback = req.body;
      // save generic
      const rec = {
        checkout_request_id: fallback.CheckoutRequestID || fallback.checkout_request_id || null,
        merchant_request_id: fallback.MerchantRequestID || fallback.merchant_request_id || null,
        phone: fallback.PhoneNumber || fallback.phone || null,
        amount: fallback.Amount || fallback.amount || null,
        status: fallback.ResultCode === 0 || fallback.result_code === 0 ? 'success' : 'failed',
        result_desc: fallback.ResultDesc || fallback.result_desc || null,
        receipt_number: fallback.MpesaReceiptNumber || fallback.receipt || null,
        transaction_date: fallback.TransactionDate || fallback.transaction_date || null,
        raw_callback: body,
        created_at: new Date().toISOString()
      };
      savePayment(rec);
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const checkout_request_id = stk.CheckoutRequestID || stk.checkoutRequestId;
    const result_code = stk.ResultCode;
    const result_desc = stk.ResultDesc;
    let amount = null, receipt = null, phone = null, trans_date = null;
    const callbackMetadata = stk.CallbackMetadata || {};
    if (callbackMetadata.Item && Array.isArray(callbackMetadata.Item)) {
      for (const it of callbackMetadata.Item) {
        const name = it.Name || it.name;
        const value = it.Value || it.value;
        if (!name) continue;
        if (name.toLowerCase().includes('mpesereceiptnumber')) receipt = value;
        if (name.toLowerCase().includes('phonenumber')) phone = String(value);
        if (name.toLowerCase().includes('amount')) amount = value;
        if (name.toLowerCase().includes('transactiondate')) trans_date = String(value);
      }
    }

    const update = {
      checkout_request_id,
      merchant_request_id: stk.MerchantRequestID || null,
      phone,
      amount,
      result_code,
      result_desc,
      receipt_number: receipt,
      transaction_date: trans_date,
      status: result_code === 0 ? 'success' : 'failed',
      raw_callback: body,
      updated_at: new Date().toISOString()
    };

    // try update existing payment, or create new
    const saved = savePayment(update);
    console.log("📥 M-Pesa callback processed:", checkout_request_id, "saved:", saved ? true : false);

    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (e) {
    console.error('mpesa callback error', e.message || e);
    return res.status(500).json({ ResultCode: 1, ResultDesc: "Error" });
  }
});

// lightweight API to read payments (used by dashboard or external)
app.get('/api/payments', (req, res) => {
  const payments = readFileSafe("payments.json", []);
  res.json(payments);
});

// -------------- final startup --------------
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    client.initialize();
    app.listen(PORT, () => {
      console.log(`🌍 Dashboard + Bot running on http://localhost:${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start app:', e?.message || e);
    process.exit(1);
  }
})();

