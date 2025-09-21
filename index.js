// index.js
import express from "express";
import fs from "fs";
import bodyParser from "body-parser";
import axios from "axios";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

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

