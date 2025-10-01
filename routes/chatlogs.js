// routes/chatlogs.js
import express from "express";
import { ChatLog } from "../models/db.js";

const router = express.Router();

// Show logs
router.get("/", async (req, res) => {
  const logs = await ChatLog.findAll({ order: [["createdAt", "DESC"]] });
  res.render("chatlogs", { logs });
});

export default router;

