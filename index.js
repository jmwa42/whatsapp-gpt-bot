import express from "express";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";
import expressLayouts from "express-ejs-layouts";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Enable body parsing for forms & JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// EJS + Layouts setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "dashboard/views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Bot data directory
const BOT_DATA_DIR = path.join(__dirname, "bot_sessions");

// Ensure directory & default files exist
if (!fs.existsSync(BOT_DATA_DIR)) fs.mkdirSync(BOT_DATA_DIR);
["business.json", "chats.json", "payments.json", "contacts.json", "broadcasts.json"].forEach(f => {
  const file = path.join(BOT_DATA_DIR, f);
  if (!fs.existsSync(file)) fs.writeFileSync(file, f === "business.json" ? "{}" : "[]");
});

// ✅ Routes

// Home
app.get("/", (req, res) => {
  res.render("index");
});

// Business Info
app.get("/business", (req, res) => {
  const file = path.join(BOT_DATA_DIR, "business.json");
  const business = JSON.parse(fs.readFileSync(file, "utf8"));
  res.render("business", { business });
});

app.post("/business", (req, res) => {
  const file = path.join(BOT_DATA_DIR, "business.json");
  fs.writeFileSync(file, JSON.stringify(req.body, null, 2));
  res.redirect("/business");
});

// Chat logs
app.get("/chatlogs", (req, res) => {
  const chats = JSON.parse(fs.readFileSync(path.join(BOT_DATA_DIR, "chats.json"), "utf8"));
  res.render("chatlogs", { chats });
});

// Payments
app.get("/payments", (req, res) => {
  const payments = JSON.parse(fs.readFileSync(path.join(BOT_DATA_DIR, "payments.json"), "utf8"));
  res.render("payments", { payments });
});

// Broadcast
app.get("/broadcast", (req, res) => {
  const broadcasts = JSON.parse(fs.readFileSync(path.join(BOT_DATA_DIR, "broadcasts.json"), "utf8"));
  res.render("broadcast", { broadcasts });
});

app.post("/send-broadcast", (req, res) => {
  const file = path.join(BOT_DATA_DIR, "broadcasts.json");
  const broadcasts = JSON.parse(fs.readFileSync(file, "utf8"));
  broadcasts.push({ message: req.body.message, date: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(broadcasts, null, 2));
  res.redirect("/broadcast");
});

// QR Code page (refreshes automatically)
app.get("/qr", (req, res) => {
  const qrDataFile = path.join(BOT_DATA_DIR, "qr.json");
  let qrImage = null;
  if (fs.existsSync(qrDataFile)) {
    const qrData = JSON.parse(fs.readFileSync(qrDataFile, "utf8"));
    if (qrData?.code) {
      qrImage = `data:image/png;base64,${Buffer.from(qrData.code).toString("base64")}`;
    }
  }
  res.render("qr", { qrImage });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Dashboard running at http://localhost:${PORT}`);
});

