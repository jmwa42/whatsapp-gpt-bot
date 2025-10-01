// routes/fees.js
import express from "express";
import { Fee } from "../models/db.js";

const router = express.Router();

// Show fees
router.get("/", async (req, res) => {
  const fees = await Fee.findAll();
  res.render("fees", { fees });
});

// Save fees
router.post("/", async (req, res) => {
  const { fees } = req.body;
  await Fee.destroy({ where: {} }); // clear old data
  if (fees && Array.isArray(fees)) {
    for (let f of fees) {
      await Fee.create({
        className: f.className,
        term1: f.term1,
        term2: f.term2,
        term3: f.term3,
        total: (Number(f.term1) || 0) + (Number(f.term2) || 0) + (Number(f.term3) || 0),
      });
    }
  }
  res.redirect("/fees");
});

export default router;

