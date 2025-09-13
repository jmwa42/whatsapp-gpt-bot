// bot/mpesa.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const MPESA_ENV = process.env.MPESA_ENV || "sandbox";
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE;
const PASSKEY = process.env.MPESA_PASSKEY;
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;         // <- your ngrok callback to Django
const DJANGO_BASE = process.env.DJANGO_BASE || "http://127.0.0.1:8001"; // <- Django is on 8001

async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  const url =
    MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const { data } = await axios.get(url, { headers: { Authorization: `Basic ${auth}` } });
  return data.access_token;
}

export async function stkPush(phone, amount, accountRef = "DashboardPayment") {
  if (!/^2547\d{8}$/.test(phone)) {
    throw new Error(`Invalid phone format: ${phone} (must be 2547XXXXXXXX)`);
  }
  const token = await getAccessToken();

  const url =
    MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const password = Buffer.from(SHORTCODE + PASSKEY + timestamp).toString("base64");

  const payload = {
    BusinessShortCode: SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: CALLBACK_URL,
    AccountReference: accountRef,
    TransactionDesc: "Payment",
  };

  console.log("📤 STK Payload:", JSON.stringify(payload, null, 2));

  const { data } = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });

  console.log("✅ STK Push Response:", data);

  if (data.ResponseCode === "0") {
    // Register initiation in Django (so callback can match it later)
    try {
      await axios.post(`${DJANGO_BASE}/api/mpesa/register-init/`, {
        MerchantRequestID: data.MerchantRequestID,
        CheckoutRequestID: data.CheckoutRequestID,
        PhoneNumber: phone,
        Amount: amount,
      });
      console.log("📌 Registered initiation in Django");
    } catch (e) {
      console.error(
        "⚠️ register-init failed:",
        e.response?.status,
        e.response?.data || e.message
      );
    }
  } else {
    console.warn("⚠️ STK push failed:", data.ResponseDescription);
  }

  return data;
}

