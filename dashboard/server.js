import express from "express";
import fs from "fs";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// --- Routes ---
app.get("/", (req, res) => {
  res.render("index");
});

app.get("/business", (req, res) => {
  const biz = JSON.parse(fs.readFileSync("./bot/business.json", "utf8"));
  res.render("business", { biz });
});

app.post("/business", (req, res) => {
  const updated = {
    opening_hours: req.body.opening_hours,
    location: req.body.location,
    contact: req.body.contact,
    price_list: {}
  };
  req.body.services?.forEach((svc, i) => {
    if (svc) updated.price_list[svc] = req.body.prices[i] || "";
  });
  fs.writeFileSync("./bot/business.json", JSON.stringify(updated, null, 2));
  res.redirect("/business");
});

app.get("/chats", (req, res) => {
  const chats = fs.existsSync("./bot/chats.json")
    ? JSON.parse(fs.readFileSync("./bot/chats.json", "utf8"))
    : [];
  res.render("chats", { chats });
});

app.get("/payments", (req, res) => {
  const payments = fs.existsSync("./bot/payments.json")
    ? JSON.parse(fs.readFileSync("./bot/payments.json", "utf8"))
    : [];
  res.render("payments", { payments });
});

app.listen(3000, () =>
  console.log("🌐 Dashboard running at http://localhost:3000")
);

