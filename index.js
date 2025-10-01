import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
import axios from 'axios';
import expressLayouts from 'express-ejs-layouts';
import bcrypt from 'bcrypt';
import session from 'express-session';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { v4 as uuidv4 } from 'uuid';

// local bot helpers (must exist)
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

// --- paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOT_DATA_DIR = path.join(__dirname, 'bot');
const VOLUME_DIR = process.env.SESSION_DIR || path.join(__dirname, '.wwebjs_auth');
if (!fs.existsSync(BOT_DATA_DIR)) fs.mkdirSync(BOT_DATA_DIR, { recursive: true });
if (!fs.existsSync(VOLUME_DIR)) fs.mkdirSync(VOLUME_DIR, { recursive: true });

// init files
const filesToInit = [
  'business.json',
  'chats.json',
  'payments.json',
  'contacts.json',
  'broadcasts.json',
  'faqs.json',
  'fees.json',
  'activities.json',
  'transport.json',
  'meta.json',
  'users.json',
  'qr.json'
];
for (const f of filesToInit) {
  const p = path.join(BOT_DATA_DIR, f);
  if (!fs.existsSync(p)) {
    let init = '[]';
    if (f === 'business.json' || f === 'fees.json' || f === 'activities.json' || f === 'meta.json' || f === 'users.json' || f === 'qr.json') init = '{}';
    if (f === 'faqs.json') init = '[]';
    if (f === 'payments.json') init = '[]';
    fs.writeFileSync(p, init);
  }
}

// --- safe JSON helpers (repair corrupted files) ---
function readFileSafe(filename, fallback) {
  const full = path.join(BOT_DATA_DIR, filename);
  try {
    if (!fs.existsSync(full)) return fallback;
    const raw = fs.readFileSync(full, 'utf8');
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`readFileSafe: parse error for ${filename}:`, e.message);
    // move corrupt file aside and create a fresh fallback
    try {
      const corruptPath = full + '.corrupt.' + Date.now();
      fs.renameSync(full, corruptPath);
      console.warn(`Moved corrupted ${filename} -> ${corruptPath}`);
    } catch (renameErr) {
      console.warn('Failed to move corrupt file:', renameErr.message);
    }
    try { fs.writeFileSync(full, JSON.stringify(fallback, null, 2)); } catch (w) { console.error('Failed to write fallback', w.message); }
    return fallback;
  }
}
function writeFileSafe(filename, obj) {
  const full = path.join(BOT_DATA_DIR, filename);
  try {
    fs.writeFileSync(full, JSON.stringify(obj, null, 2));
    return true;
  } catch (e) {
    console.error('writeFileSafe error', filename, e.message);
    return false;
  }
}
function appendJson(filename, item) {
  const arr = readFileSafe(filename, []);
  arr.push(item);
  writeFileSafe(filename, arr);
}

// --- simple users (file-based) ---
function readUsers() {
  return readFileSafe('users.json', []);
}
function writeUsers(users) {
  return writeFileSafe('users.json', users);
}
async function createUser({ username, password, role = 'admin' }) {
  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('user exists');
  const passwordHash = await bcrypt.hash(password, 10);
  const u = { id: uuidv4(), username, passwordHash, role, created_at: new Date().toISOString() };
  users.push(u);
  writeUsers(users);
  return { id: u.id, username: u.username, role: u.role };
}

// Auto-create default admin if requested via env (dev convenience)
(async () => {
  try {
    const users = readUsers();
    if ((!users || users.length === 0) && process.env.AUTO_CREATE_ADMIN === '1') {
      const user = process.env.ADMIN_USER || 'admin';
      const pass = process.env.ADMIN_PASS || 'changeme';
      console.warn('AUTO_CREATE_ADMIN is set — creating default admin:', user);
      await createUser({ username: user, password: pass, role: 'admin' });
      console.warn('Default admin created. Change the password or disable AUTO_CREATE_ADMIN in production.');
    }
  } catch (e) {
    console.error('Failed to auto-create admin', e.message || e);
  }
})();

// --- passport local auth setup ---
const app = express();
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ SESSION_SECRET must be set in production');
  process.exit(1);
}

app.use(session({
  secret: SESSION_SECRET || 'dev_session_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production' }
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const users = readUsers();
    const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
    if (!user) return done(null, false, { message: 'Invalid username or password' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return done(null, false, { message: 'Invalid username or password' });
    return done(null, { id: user.id, username: user.username, role: user.role });
  } catch (e) {
    return done(e);
  }
}));
passport.serializeUser((u, done) => done(null, u.id));
passport.deserializeUser((id, done) => {
  try {
    const users = readUsers();
    const user = users.find(x => x.id === id);
    if (!user) return done(null, false);
    return done(null, { id: user.id, username: user.username, role: user.role });
  } catch (e) {
    done(e);
  }
});

// make user available in templates
app.use((req, res, next) => { res.locals.user = req.user || null; next(); });

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect('/login');
}
function hasRole(roles = []) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).send('Unauthorized');
    if (roles.includes(req.user.role)) return next();
    return res.status(403).send('Forbidden');
  };
}

// ----- Express / Views setup -----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'dashboard', 'views'));
app.use(expressLayouts);
app.set('layout', false); 
// app.set('layout', 'layout');

// ----- WhatsApp client setup -----
let latestQR = null;
let isClientReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: VOLUME_DIR }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  },
  takeoverOnConflict: true,
});

client.on('qr', qr => {
  latestQR = qr;
  writeFileSafe('qr.json', { qr, updated_at: new Date().toISOString() });
  console.log('📱 QR generated — visit /qr to scan');
});
client.on('ready', () => { isClientReady = true; console.log('✅ WhatsApp client ready'); });
client.on('auth_failure', msg => console.error('Auth failure:', msg));
client.on('disconnected', reason => { isClientReady = false; console.warn('WhatsApp disconnected:', reason); });

// send helper
async function sendMessageTo(number, message) {
  const jid = number.includes('@') ? number : `${number}@c.us`;
  return client.sendMessage(jid, message);
}

// small NLP helpers (FAQ matching)
function tokens(s) { if (!s) return []; return s.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean); }
function faqMatches(text, question) {
  const t = tokens(text); const q = tokens(question);
  if (q.length === 0 || t.length === 0) return false;
  const setT = new Set(t);
  const overlap = q.filter(w => setT.has(w)).length;
  if (overlap >= Math.min(2, q.length)) return true;
  return text.toLowerCase().includes(question.toLowerCase().slice(0, Math.max(6, Math.floor(question.length/3))));
}

// transport lookup
const transportFile = path.join(BOT_DATA_DIR, 'transport.json');
function findTransportFee(text) {
  try {
    const fees = readFileSafe('transport.json', []);
    const t = String(text || '').toLowerCase();
    for (const fee of fees) {
      const route = String(fee.route || '').toLowerCase();
      // Safely handle courts as string or array
      const courtsRaw = fee.courts || '';
      const courts = (Array.isArray(courtsRaw) ? courtsRaw : String(courtsRaw).split(','))
        .map(s => String(s).trim().toLowerCase())
        .filter(Boolean);
      
      if (t.includes(route)) {
        for (const court of courts) {
          if (court && t.includes(court)) {
            return `🚍 Transport for ${fee.route} (court ${court}) is Ksh ${fee.amount}`;
          }
        }
      }
    }
  } catch (e) { 
    console.warn('findTransportFee error', e.message); 
  }
  return null;
}

// save/update payment
function savePayment(paymentObj) {
  const payments = readFileSafe('payments.json', []);
  if (paymentObj.checkout_request_id) {
    const idx = payments.findIndex(p => p.checkout_request_id === paymentObj.checkout_request_id);
    if (idx !== -1) { payments[idx] = { ...payments[idx], ...paymentObj }; writeFileSafe('payments.json', payments); return payments[idx]; }
  }
  payments.push(paymentObj); writeFileSafe('payments.json', payments); return paymentObj;
}

// ---------- Main message handler ----------
client.on('message', async (msg) => {
  try {
    const number = msg.from; // whatsapp jid
    const text = (msg.body || '').trim();
    console.log('📩 Incoming:', number, text);

    // store incoming
    appendJson('chats.json', { number, from: 'user', text, timestamp: new Date().toISOString() });
    await saveUserMessage(number, 'user', text);

    // banned check
    if (await isBanned(number)) { await msg.reply('🚫 You are banned from using this service.'); return; }

    // admin commands
    if (text.startsWith('/ban ')) { const toBan = text.split(' ')[1]; await banUser(toBan); await msg.reply(`🚫 ${toBan} has been banned.`); return; }
    if (text.startsWith('/unban ')) { const toUnban = text.split(' ')[1]; await unbanUser(toUnban); await msg.reply(`✅ ${toUnban} has been unbanned.`); return; }
    if (text === '/history') { const history = await getUserHistory(number); await msg.reply(`🕓 You have ${history.length} messages stored.`); return; }

    // /pay command
    if (text.toLowerCase().startsWith('/pay')) {
      const parts = text.split(' ');
      const amount = parts[1];
      if (!amount) { await msg.reply('⚠️ Usage: /pay <amount>'); return; }
      const phone = number.replace(/@.*$/, '');
      try {
        const darajaResp = await stkPush(phone, amount);
        // register local initiation
        const rec = {
          merchant_request_id: darajaResp?.MerchantRequestID || darajaResp?.merchantRequestId || null,
          checkout_request_id: darajaResp?.CheckoutRequestID || darajaResp?.checkoutRequestId || null,
          phone, amount, status: 'initiated', created_at: new Date().toISOString(), raw_response: darajaResp
        };
        savePayment(rec);
        await msg.reply('📲 Payment request sent. Check your phone to complete.');
      } catch (err) {
        console.error('M-Pesa error', err?.response?.data || err?.message || err);
        await msg.reply('❌ Payment failed. Please try again later.');
      }
      return;
    }

    // 1) transport fees
    const transportReply = findTransportFee(text);
    if (transportReply) { await msg.reply(transportReply); appendJson('chats.json', { number, from: 'bot', text: transportReply, timestamp: new Date().toISOString() }); await saveUserMessage(number, 'bot', transportReply); return; }

    // load school data
    const faqs = readFileSafe('faqs.json', []);
    const fees = readFileSafe('fees.json', {});
    const activities = readFileSafe('activities.json', {});
    const meta = readFileSafe('meta.json', {});

    // 2) FAQ matching
    for (const f of faqs) {
      const q = f.question || f.q || '';
      const a = f.answer || f.a || '';
      if (!q) continue;
      if (faqMatches(text, q)) {
        const replyText = `✅ ${a}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
        await msg.reply(replyText);
        appendJson('chats.json', { number, from: 'bot', text: replyText, timestamp: new Date().toISOString() });
        await saveUserMessage(number, 'bot', replyText);
        return;
      }
    }

    // 3) fees lookup
    const lowered = text.toLowerCase();
    let feeMatched = null;
    for (const cls of Object.keys(fees || {})) {
      const clsLower = cls.toLowerCase();
      if (lowered.includes(clsLower) || lowered.includes(clsLower.replace(/\s+/g, ''))) { feeMatched = { cls, amount: fees[cls] }; break; }
      const digits = cls.match(/\d+/);
      if (digits && lowered.includes(digits[0])) { feeMatched = { cls, amount: fees[cls] }; break; }
    }
    if (feeMatched) {
      const reply = `💰 Fees for ${feeMatched.cls}: ${feeMatched.amount}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
      await msg.reply(reply);
      appendJson('chats.json', { number, from: 'bot', text: reply, timestamp: new Date().toISOString() });
      await saveUserMessage(number, 'bot', reply);
      return;
    } else if (lowered.includes('fee') || lowered.includes('fees')) {
      const summary = Object.entries(fees || {}).map(([k,v]) => `${k}: ${v}`).join('\n') || 'No fees set.';
      const reply = `💰 School Fees:\n${summary}\n\nℹ️ Info last updated: ${meta.last_updated || 'unknown'}`;
      await msg.reply(reply);
      appendJson('chats.json', { number, from: 'bot', text: reply, timestamp: new Date().toISOString() });
      await saveUserMessage(number, 'bot', reply);
      return;
    }

    // 4) activities keywords
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
          appendJson('chats.json', { number, from: 'bot', text: replyText, timestamp: new Date().toISOString() });
          await saveUserMessage(number, 'bot', replyText);
          return;
        }
      }
    }

    // 5) GPT fallback
    try {
      const reply = await handleMessage(number, text);
      await saveUserMessage(number, 'bot', reply);
      appendJson('chats.json', { number, from: 'bot', text: reply, timestamp: new Date().toISOString() });
      await msg.reply(reply);
    } catch (err) {
      console.error('GPT error', err?.message || err);
      const fallback = '❌ Sorry, something went wrong. Please try again later.';
      appendJson('chats.json', { number, from: 'bot', text: fallback, timestamp: new Date().toISOString() });
      await msg.reply(fallback);
    }
  } catch (e) {
    console.error('message handler crashed:', e?.message || e);
  }
});

// ---------- Dashboard + API routes ----------
app.get('/health', (req, res) => res.json({ ok: true }));

// Login/logout (public)
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.render('login', { error: info?.message || 'Invalid credentials' });
    req.logIn(user, (err) => { if (err) return next(err); return res.redirect('/'); });
  })(req, res, next);
});
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/login')); });

// Root/dashboard home (requires auth)
app.get('/', isAuthenticated, (req, res) => {
  res.render('index', { lastUpdated: readFileSafe('meta.json', {}).last_updated || null });
});

// Business editor
app.get('/business', isAuthenticated, (req, res) => {
  const biz = readFileSafe('business.json', { opening_hours: '', location: '', contact: '', price_list: {} });
  res.render('business', { biz, lastUpdated: readFileSafe('meta.json', {}).last_updated || null });
});
app.post('/business', isAuthenticated, (req, res) => {
  const updated = { opening_hours: req.body.opening_hours || '', location: req.body.location || '', contact: req.body.contact || '', price_list: {} };
  const services = Array.isArray(req.body.services) ? req.body.services : (req.body.services ? [req.body.services] : []);
  const prices = Array.isArray(req.body.prices) ? req.body.prices : (req.body.prices ? [req.body.prices] : []);
  services.forEach((svc, i) => { if (svc) updated.price_list[svc] = prices[i] || ''; });
  writeFileSafe('business.json', updated);
  const meta = readFileSafe('meta.json', {}); meta.last_updated = new Date().toISOString(); writeFileSafe('meta.json', meta);
  res.redirect('/business');
});

// QR page (public so you can scan)
app.get('/qr', async (req, res) => {
  const qrObj = readFileSafe('qr.json', {});
  const latest = qrObj.qr || latestQR;
  if (!latest) return res.send('<h2>No QR generated yet. Check back soon.</h2>');
  try { const qrImg = await qrcode.toDataURL(latest); res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp QR</title><meta http-equiv="refresh" content="10"></head><body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;color:#fff;"><div style="text-align:center"><h3>Scan QR with WhatsApp</h3><img src="${qrImg}" style="max-width:90vw;max-height:80vh;"/></div></body></html>`); }
  catch (e) { console.error('QR render error', e.message || e); res.status(500).send('Error generating QR'); }
});

// Chatlogs (requires auth)
app.get('/chatlogs', isAuthenticated, async (req, res) => {
  try {
    const { data } = await axios.get((process.env.DJANGO_BASE || 'http://127.0.0.1:8000') + '/api/chat/', { timeout: 4000 });
    return res.render('chatlogs', { chatlogs: data });  // ✅ Correct variable name
  } catch (e) {
    const chats = readFileSafe('chats.json', []);
    return res.render('chatlogs', { chatlogs });  // ✅ Correct variable name
  }
});

// Payments view
app.get('/payments', isAuthenticated, async (req, res) => {
  try {
    const { data } = await axios.get((process.env.DJANGO_BASE || 'http://127.0.0.1:8000') + '/api/mpesa/payments/', { timeout: 4000 });
    return res.render('payments', { payments: data });
  } catch (e) {
    const payments = readFileSafe('payments.json', []);
    return res.render('payments', { payments });
  }
});

//broadcast GET route
app.get('/broadcast', isAuthenticated, (req, res) => {
  res.render('broadcast');
});

// -------- FAQ CRUD --------
app.get('/faqs', isAuthenticated, (req, res) => {
  const faqs = readFileSafe('faqs.json', []);
  res.render('faqs', { faqs, lastUpdated: readFileSafe('meta.json', {}).last_updated || null });
});
app.post('/faqs/add', hasRole(['admin','staff']), (req, res) => {
  const faqs = readFileSafe('faqs.json', []);
  const question = (req.body.question || '').trim(); const answer = (req.body.answer || '').trim();
  if (question && answer) { faqs.push({ id: uuidv4(), question, answer, created_at: new Date().toISOString() }); writeFileSafe('faqs.json', faqs); const meta = readFileSafe('meta.json', {}); meta.last_updated = new Date().toISOString(); writeFileSafe('meta.json', meta); }
  res.redirect('/faqs');
});
app.post('/faqs/edit/:id', hasRole(['admin','staff']), (req, res) => {
  const id = req.params.id; const faqs = readFileSafe('faqs.json', []);
  const idx = faqs.findIndex(f => f.id === id); if (idx === -1) return res.redirect('/faqs');
  faqs[idx].question = (req.body.question || '').trim(); faqs[idx].answer = (req.body.answer || '').trim(); faqs[idx].updated_at = new Date().toISOString(); writeFileSafe('faqs.json', faqs); const meta = readFileSafe('meta.json', {}); meta.last_updated = new Date().toISOString(); writeFileSafe('meta.json', meta); res.redirect('/faqs');
});
app.post('/faqs/delete/:id', hasRole(['admin']), (req, res) => {
  const id = req.params.id; let faqs = readFileSafe('faqs.json', []); faqs = faqs.filter(f => f.id !== id); writeFileSafe('faqs.json', faqs); const meta = readFileSafe('meta.json', {}); meta.last_updated = new Date().toISOString(); writeFileSafe('meta.json', meta); res.redirect('/faqs');
});

// -------- Fees CRUD --------
app.get('/fees', isAuthenticated, (req, res) => { const fees = readFileSafe('fees.json', {}); res.render('fees', { fees, lastUpdated: readFileSafe('meta.json', {}).last_updated || null }); });
app.post('/fees', hasRole(['admin']), (req, res) => { const updated = {}; const classes = Array.isArray(req.body.classes) ? req.body.classes : (req.body.classes ? [req.body.classes] : []); const amounts = Array.isArray(req.body.amounts) ? req.body.amounts : (req.body.amounts ? [req.body.amounts] : []); classes.forEach((cls, i) => { if (cls) updated[cls] = amounts[i] || ''; }); writeFileSafe('fees.json', updated); const meta = readFileSafe('meta.json', {}); meta.last_updated = new Date().toISOString(); writeFileSafe('meta.json', meta); res.redirect('/fees'); });

// -------- Activities CRUD --------
app.get('/activities', isAuthenticated, (req, res) => { const activities = readFileSafe('activities.json', {}); res.render('activities', { activities, lastUpdated: readFileSafe('meta.json', {}).last_updated || null }); });
app.post('/activities', hasRole(['admin','staff']), (req, res) => { const updated = { opening_date: req.body.opening_date || '', closing_date: req.body.closing_date || '', parents_meeting: req.body.parents_meeting || '', school_trip: req.body.school_trip || '', exams_start: req.body.exams_start || '' }; writeFileSafe('activities.json', updated); const meta = readFileSafe('meta.json', {}); meta.last_updated = new Date().toISOString(); writeFileSafe('meta.json', meta); res.redirect('/activities'); });

// -------- Transport CRUD --------
app.get('/transport', isAuthenticated, (req, res) => { const transport = readFileSafe('transport.json', []); res.render('transport', { transport }); });
app.post('/dashboard/transport', hasRole(['admin']), (req, res) => { 
  const transport = readFileSafe('transport.json', []); 
  transport.push({ 
    id: uuidv4(), 
    route: req.body.route || '', 
    courts: req.body.courts || '', 
    amount: req.body.fee || ''  // FIX 2: Changed from req.body.amount
  }); 
  writeFileSafe('transport.json', transport); 
  const meta = readFileSafe('meta.json', {}); 
  meta.last_updated = new Date().toISOString(); 
  writeFileSafe('meta.json', meta); 
  res.redirect('/transport'); 
});


// -------- Broadcast/contacts --------
app.post('/broadcast', hasRole(['admin','staff']), async (req, res) => {
  const message = req.body.message; const numbersRaw = req.body.numbers || ''; const numbers = numbersRaw ? numbersRaw.split(',').map(s => s.trim()).filter(Boolean) : null;
  if (!message) return res.status(400).send('Message required');
  if (!isClientReady) return res.status(503).send('WhatsApp not ready');
  let targets = numbers; if (!targets) { const contacts = readFileSafe('contacts.json', []); targets = (contacts || []).map(c => c.number || c.phone).filter(Boolean); }
  if (!targets || targets.length === 0) return res.status(400).send('No targets');
  const results = [];
  for (const n of targets) { try { await sendMessageTo(n, message); results.push({ to: n, ok: true }); } catch (e) { results.push({ to: n, ok: false, error: e?.message || e }); } }
  appendJson('broadcasts.json', { message, targets, results, created_at: new Date().toISOString() });
  res.redirect('/');
});
app.post('/send-broadcast', hasRole(['admin','staff']), async (req, res) => { const { message, numbers } = req.body; if (!message) return res.status(400).json({ error: 'message required' }); if (!isClientReady) return res.status(503).json({ error: 'whatsapp not ready' }); const targets = Array.isArray(numbers) && numbers.length ? numbers : (readFileSafe('contacts.json', [])).map(c => c.number || c.phone).filter(Boolean); if (!targets || targets.length === 0) return res.status(400).json({ error: 'no targets' }); const results = []; for (const n of targets) { try { await sendMessageTo(n, message); results.push({ to: n, ok: true }); } catch (e) { results.push({ to: n, ok: false, error: e?.message || e }); } } appendJson('broadcasts.json', { message, targets, results, created_at: new Date().toISOString() }); res.json({ ok: true, results }); });

// ---------- MPESA endpoints (public) ----------
app.post('/api/mpesa/register-init', (req, res) => {
  try {
    const body = req.body || {};
    const rec = { merchant_request_id: body.MerchantRequestID || body.merchant_request_id || null, checkout_request_id: body.CheckoutRequestID || body.checkout_request_id || null, phone: body.PhoneNumber || body.phone || null, amount: body.Amount || body.amount || null, status: 'initiated', created_at: new Date().toISOString(), raw_request: body };
    savePayment(rec);
    console.log('📌 register-init saved:', rec.checkout_request_id || rec.merchant_request_id);
    return res.json({ ok: true, created: true, id: rec.checkout_request_id || null });
  } catch (e) { console.error('register-init error', e.message || e); return res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/mpesa/callback', (req, res) => {
  try {
    const body = req.body || {};
    console.log('🔔 M-Pesa Callback (raw):', JSON.stringify(body).slice(0, 2000));
    const stk = (body.Body && body.Body.stkCallback) ? body.Body.stkCallback : null;
    if (!stk) {
      // accept generic/manual test payloads
      const fb = req.body || {};
      const rec = { checkout_request_id: fb.CheckoutRequestID || fb.checkout_request_id || null, merchant_request_id: fb.MerchantRequestID || fb.merchant_request_id || null, phone: fb.PhoneNumber || fb.phone || null, amount: fb.Amount || fb.amount || null, status: fb.ResultCode === 0 || fb.result_code === 0 ? 'success' : 'failed', result_desc: fb.ResultDesc || fb.result_desc || null, receipt_number: fb.MpesaReceiptNumber || fb.receipt || null, transaction_date: fb.TransactionDate || fb.transaction_date || null, raw_callback: body, created_at: new Date().toISOString() };
      savePayment(rec);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const checkout_request_id = stk.CheckoutRequestID || stk.checkoutRequestId;
    const result_code = stk.ResultCode;
    const result_desc = stk.ResultDesc;
    let amount = null, receipt = null, phone = null, trans_date = null;
    const items = (stk.CallbackMetadata && stk.CallbackMetadata.Item) ? stk.CallbackMetadata.Item : [];
    for (const it of items) {
      const name = it.Name || it.name || '';
      const value = it.Value || it.value;
      if (!name) continue;
      if (name.toLowerCase().includes('mpesereceiptnumber')) receipt = value;
      if (name.toLowerCase().includes('phonenumber')) phone = String(value);
      if (name.toLowerCase().includes('amount')) amount = value;
      if (name.toLowerCase().includes('transactiondate')) trans_date = String(value);
    }

    const update = { checkout_request_id, merchant_request_id: stk.MerchantRequestID || null, phone, amount, result_code, result_desc, receipt_number: receipt, transaction_date: trans_date, status: result_code === 0 ? 'success' : 'failed', raw_callback: body, updated_at: new Date().toISOString() };
    const saved = savePayment(update);
    console.log('📥 M-Pesa callback processed:', checkout_request_id);
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (e) {
    console.error('mpesa callback error', e.message || e);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Error' });
  }
});

app.get('/api/payments', (req, res) => { res.json(readFileSafe('payments.json', [])); });

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await client.initialize(); // Make this await and wrap properly
    app.listen(PORT, () => 
      console.log(`🌍 Dashboard + Bot running on http://localhost:${PORT}`)
    );
  } catch (e) {
    console.error('Failed to start WhatsApp client:', e?.message || e);
    // Still start server even if WhatsApp fails
    app.listen(PORT, () => 
      console.log(`🌍 Dashboard running (WhatsApp error) on http://localhost:${PORT}`)
    );
  }
})();

