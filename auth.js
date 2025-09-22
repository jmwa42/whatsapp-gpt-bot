// auth.js
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import passport from 'passport';
import session from 'express-session';
import { Strategy as LocalStrategy } from 'passport-local';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BOT_DATA_DIR = path.join(__dirname, 'bot'); // adjust if your bot folder path differs
const usersFile = path.join(BOT_DATA_DIR, 'users.json');

function readUsers() {
  if (!fs.existsSync(usersFile)) return [];
  try { return JSON.parse(fs.readFileSync(usersFile, 'utf8')) || []; }
  catch (e) { console.warn('readUsers parse error', e.message); return []; }
}
function writeUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

export function initAuth(app) {
  const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret_change_me';
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // set true when using HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const users = readUsers();
      const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (!user) return done(null, false, { message: 'Invalid username or password' });
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return done(null, false, { message: 'Invalid username or password' });
      // return a minimal user object stored in session
      return done(null, { id: user.id, username: user.username, role: user.role });
    } catch (e) {
      return done(e);
    }
  }));

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    try {
      const users = readUsers();
      const u = users.find(x => x.id === id);
      if (!u) return done(null, false);
      return done(null, { id: u.id, username: u.username, role: u.role });
    } catch (e) {
      done(e);
    }
  });

  // expose user to templates
  app.use((req, res, next) => {
    res.locals.user = req.user || null;
    next();
  });

  function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    return res.redirect('/login');
  }

  function hasRole(allowedRoles = []) {
    return (req, res, next) => {
      if (req.isAuthenticated() && allowedRoles.includes(req.user.role)) return next();
      res.status(403).send('Forbidden');
    };
  }

  return { isAuthenticated, hasRole, readUsers, writeUsers };
}

// convenience helper: synchronous create user (used by script)
export function createUserSync({ username, password, role = 'admin' }) {
  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('User already exists');
  }
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = { id, username, passwordHash, role, created_at: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  return { id, username, role };
}

