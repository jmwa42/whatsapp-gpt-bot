import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, '../data');
const dbFile = join(dbDir, 'messages.json');

// 🔹 Ensure data folder exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// 🔹 Ensure file exists with defaults
if (!fs.existsSync(dbFile)) {
  fs.writeFileSync(dbFile, JSON.stringify({ messages: {}, banned: [] }, null, 2));
}

const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { messages: {}, banned: [] });

await db.read();


// 🔹 Force defaults every time
if (!db.data || typeof db.data !== 'object') {
  db.data = { messages: {}, banned: [] };
  await db.write();
}

export async function getUserHistory(user) {
  await db.read();
  return db.data.messages[user] || [];
}

export async function saveUserMessage(user, from, text) {
  await db.read();
  db.data.messages[user] ||= [];
  db.data.messages[user].push({ from, text });
  await db.write();
}

export async function isBanned(user) {
  await db.read();
  return db.data.banned.includes(user);
}

export async function banUser(user) {
  await db.read();
  if (!db.data.banned.includes(user)) {
    db.data.banned.push(user);
    await db.write();
  }
}

export async function unbanUser(user) {
  await db.read();
  db.data.banned = db.data.banned.filter(u => u !== user);
  await db.write();
}

