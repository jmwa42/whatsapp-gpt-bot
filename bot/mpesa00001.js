import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// 🔑 Load environment variables
const MPESA_ENV = process.env.MPESA_ENV || "sandbox"; // "sandbox" or "production"
const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE = process.env.MPESA_SHORTCODE; // e.g. 600XXX
const PASSKEY = process.env.MPESA_PASSKEY; // from Safaricom portal
const CALLBACK_URL = process.env.MPESA_CALLBACK_URL;

// ✅ Get OAuth token
async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");

  const url =
    MPESA_ENV === "production"
      ? "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Basic ${auth}` }
    });
    console.log("🔑 Got Access Token");
    return data.access_token;
  } catch (err) {
    console.error("❌ Failed to get access token:", err.response?.data || err.message);
    throw err;
  }
}

// ✅ STK Push function
// ✅ STK Push function
export async function stkPush(phone, amount, accountRef = "School Fees") {
  try {
    // Ensure phone is in 2547XXXXXXXX format
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

    // 🔹 Safaricom STK push request
    const { data } = await axios.post(url, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("✅ STK Push Response:", data);

    // 🔹 Register initiation in Django only if successful
    if (data.ResponseCode === "0") {
      try {
        await axios.post("http://127.0.0.1:8001/api/mpesa/register-init/", {
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
  } catch (err) {
    console.error("❌ STK Push Error:", err.response?.data || err.message);
    throw err;
  }
}

