import dotenv from 'dotenv';
dotenv.config();

console.log("🔑 Loaded OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Present" : "❌ Missing");


import fs from 'fs';
import { OpenAI } from 'openai';
import { getUserHistory } from './storage.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "fallback-key-here"
});


let schoolData = JSON.parse(fs.readFileSync('./bot/school.json', 'utf-8'));

export function reloadSchoolData() {
  schoolData = JSON.parse(fs.readFileSync('./bot/school.json', 'utf-8'));
  console.log("🔄 School data reloaded");
}

function formatSchoolPrompt(data) {
  return `
You are a helpful assistant for ${data.school_name}.

📍 Location: ${data.location}
🕒 Opening Hours: ${data.opening_hours}
📞 Contacts:
${Object.entries(data.contact || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
✉️ Email: ${data.email}
🌐 Website: ${data.website}

🎓 Academics:
${Object.entries(data.academics || {}).map(([k, v]) => `• ${k}: ${v}`).join('\n\n')}

🎨 Co-Curricular:
${Object.entries(data["Co-curricular Activities"] || {}).map(([k, v]) => `• ${k}: ${v}`).join('\n\n')}

💬 Services:
${Object.entries(data.services || {}).map(([k, v]) => `• ${k}: ${v}`).join('\n')}
`.trim();
}

export async function handleMessage(number, text) {
  const history = (await getUserHistory(number)).slice(-20); // keep last 20 msgs

  const messages = [
    { role: 'system', content: formatSchoolPrompt(schoolData) },
    ...history.map(entry => ({
      role: entry.from === 'user' ? 'user' : 'assistant',
      content: entry.text
    })),
    { role: 'user', content: text }
  ];

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages,
      temperature: 0.7
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI error:', err.response?.data || err.message);
    return '❌ Sorry, something went wrong.';
  }
}

