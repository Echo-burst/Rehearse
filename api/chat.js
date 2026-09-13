// Runs on Vercel's server, not in the browser.
// This is the only place the AI provider key is ever used, so it never reaches
// the user's phone. Set GROQ_API_KEY in Vercel -> Settings -> Environment Variables.

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

// Language codes from the interface, written out for the model.
const LANGUAGE_NAME = {
  en: "English",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  de: "German",
};

// --- PROMPT 1: the AI plays the other person --------------------------------
function roleplayPrompt(s, language) {
  return `You are role-playing one side of a difficult conversation so that a person can practise it.

You are playing: ${s.counterpart}
The conversation is about: ${s.title}
How this person behaves: ${s.context}

Rules:
- Write every reply in ${language}, regardless of the language the user writes in.
- Stay in character as ${s.counterpart}. Never break character, never mention that you are an AI.
- Reply with 1 to 3 sentences. Real people in real conversations are brief.
- Push back realistically. Do not agree quickly or hand the person what they want after one good sentence.
- If they make a genuinely strong point, soften a little, but make them work for it.
- Never be cruel, never insult them, never bring up anything that is not part of this situation.
- If they open the conversation, respond to what they said. If the transcript is empty, start the conversation naturally.

Reply with only what ${s.counterpart} says out loud. No stage directions, no narration, no quotation marks.`;
}

// --- PROMPT 2: the AI reviews how the person did ----------------------------
function evaluatePrompt(s, language) {
  return `You are a communication coach reviewing a transcript of someone practising a difficult conversation.

The conversation was about: ${s.title}
They were talking to: ${s.counterpart}
What they wanted to walk away with: ${s.goal}

Look only at the messages from "user". Consider three things:
1. Clarity - did they get across what they wanted?
2. Steadiness - did they hold their ground when pushed, without becoming harsh?
3. Listening - did they respond to what the other person actually said?

Your tone is warm and encouraging, the way a supportive friend would be. This
person is practising something difficult and may be nervous about it. Never
scold, never list faults, never imply they did badly.

Write the "verdict" and "feedback" values in ${language}. Keep the JSON keys in English.

Respond with valid JSON only. No markdown, no code fences, no text outside the JSON.

{
  "score": <whole number 1-10>,
  "verdict": "<four words or fewer, encouraging in tone>",
  "feedback": "<120-180 words. Start with something specific that worked, quoting a few of their own words. Then offer one gentle suggestion, phrased as an idea to try rather than a correction, and give one sentence they could say next time. Address them directly as 'you'. Warm, encouraging, never critical.>"
}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const { mode, scenario, messages = [], language = "en" } = req.body || {};

  if (!scenario || !mode) {
    return res.status(400).json({ error: "Missing mode or scenario." });
  }

  const languageName = LANGUAGE_NAME[language] || "English";
  const system =
    mode === "evaluate"
      ? evaluatePrompt(scenario, languageName)
      : roleplayPrompt(scenario, languageName);

  // In roleplay the AI is the other person, so the roles pass through as they are.
  // In evaluate the AI is an outside reviewer, so the whole transcript is handed
  // over as one block of text for it to read.
  const chat =
    mode === "evaluate"
      ? [
          { role: "system", content: system },
          {
            role: "user",
            content: messages
              .map((m) => (m.role === "user" ? "user: " : "them: ") + m.content)
              .join("\n"),
          },
        ]
      : [{ role: "system", content: system }, ...messages];

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.GROQ_API_KEY,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: chat,
        temperature: mode === "evaluate" ? 0.3 : 0.8,
        max_tokens: mode === "evaluate" ? 2000 : 400,
        ...(mode === "evaluate" && { response_format: { type: "json_object" } }),
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Provider error:", detail);
      return res.status(502).json({ error: "AI provider rejected the request." });
    }

    const data = await upstream.json();
    const text = data.choices?.[0]?.message?.content?.trim() || "";

    if (mode === "roleplay") {
      return res.status(200).json({ reply: text });
    }

    // The model sometimes wraps JSON in code fences despite the instruction.
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      return res.status(200).json({
        score: Number(parsed.score) || 0,
        verdict: parsed.verdict || "",
        feedback: parsed.feedback || "",
      });
    } catch {
      return res.status(200).json({
        score: 0,
        verdict: "",
        feedback: cleaned,
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Request to the AI provider failed." });
  }
}
