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
  kk: "Kazakh",
};

// --- PROMPT 1: the AI plays the other person --------------------------------
function roleplayPrompt(s, language) {
  return `You are ${s.counterpart}. You are a real person in a real, everyday moment, talking face to face with someone. Speak only as yourself.

Who you are and how you behave: ${s.context}

What the other person secretly plans to bring up: ${s.title}
This is THEIR private intention, not something you know. You have no idea what
they are about to say. Never mention it, hint at it, or guess it. Only react to
it once they actually say it out loud themselves.

How to speak:
- Talk in the first person, as yourself, and call the other person "you".
  Do not narrate the two of you: never refer to yourself or them in the third
  person, never describe what they seem to want or feel, and never sum up what
  the conversation is about.
- Talking about other people is completely normal. If they mention someone -
  a friend, a parent, a boss, a partner - talk about that person naturally,
  the way you would in real life. You can also bring up people from your own
  life when it fits who you are.
- You are not a host, coach, assistant or therapist. Never say things like
  "what's on your mind?", "you seemed like you wanted to talk about...", or
  "let's talk about...". Never offer help with the conversation itself.
- Write every reply in ${language}, regardless of the language they write in.
- Reply with 1 to 3 short sentences. Real people are brief.
- Never break character and never mention that you are an AI or that this is practice.

When you speak first:
- Open the way ${s.counterpart} naturally would in this moment: a greeting,
  small talk, or something from your own day - in keeping with who you are.
- Do not raise or hint at their topic. Leave it to them to bring it up.

Once they raise it:
- React honestly, the way ${s.counterpart} really would, based on who you are.
  Push back realistically; do not hand them what they want after one good line.
  If they make a genuinely good point, soften a little, but make them earn it.
- Never be cruel, never insult them, and stay inside this situation.
- This is a spoken conversation and nothing else exists. Never ask them to send,
  show or bring documents, files, figures, screenshots or evidence, and never
  say you will check something and get back to them. If you want to stall or
  object, do it with something they can answer out loud right now.
- Never end the conversation by deferring to a later meeting, a form, or another
  person. Stay in the moment.

Reply with only the words ${s.counterpart} says out loud. No stage directions, no narration, no quotation marks, no name label.`;
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

// --- PROMPT 3: the coach explains a score and answers questions about it -----
function explainPrompt(s, language, score, feedback) {
  return `You are the same warm, encouraging communication coach who just scored a
practice conversation. The person wants to understand their score.

The conversation was about: ${s.title}
They were talking to: ${s.counterpart}
What they wanted to walk away with: ${s.goal}
The score you gave: ${score} out of 10
The notes you gave: ${feedback}

How to explain:
- Write in ${language}.
- Base everything on what they actually said. Quote a few of their own words.
- Be honest about why the score is what it is, but kind. Never scold.
- Keep it short and easy to read on a phone. Plain text only: no markdown,
  no asterisks, no headings symbols, no bullet characters.

If they did not ask anything specific, explain the score in this shape, each
part on its own short paragraph starting with its name and a colon:
Clarity: did they get across what they wanted?
Steadiness: did they hold their ground kindly when pushed?
Listening: did they respond to what the other person actually said?
To go one point higher: one concrete thing to try, with an example sentence.

If they asked a question, answer that question directly in 2 to 5 sentences,
still about this conversation and this score.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const { mode, scenario, messages = [], language = "en", score, feedback, question } = req.body || {};

  if (!scenario || !mode) {
    return res.status(400).json({ error: "Missing mode or scenario." });
  }

  const languageName = LANGUAGE_NAME[language] || "English";
  const system =
    mode === "evaluate"
      ? evaluatePrompt(scenario, languageName)
      : mode === "explain"
        ? explainPrompt(scenario, languageName, score, feedback || "")
        : roleplayPrompt(scenario, languageName);

  const transcript = messages
    .map((m) => (m.role === "user" ? "user: " : "them: ") + m.content)
    .join("\n");

  // In roleplay the AI is the other person, so the roles pass through as they are.
  // In evaluate the AI is an outside reviewer, so the whole transcript is handed
  // over as one block of text for it to read.
  const chat =
    mode === "evaluate"
      ? [
          { role: "system", content: system },
          { role: "user", content: transcript },
        ]
      : mode === "explain"
      ? [
          { role: "system", content: system },
          {
            role: "user",
            content:
              "Transcript:\n" + transcript + "\n\n" +
              (question ? "My question: " + String(question).slice(0, 500) : "Why did I get this score?"),
          },
        ]
      : [
          { role: "system", content: system },
          // When the character opens, give the model a neutral cue instead of an
          // empty transcript, so it starts the scene in character rather than
          // describing it.
          ...(messages.length === 0
            ? [{ role: "user", content: "(You meet. Say your first words to them.)" }]
            : messages),
        ];

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
        temperature: mode === "evaluate" ? 0.3 : mode === "explain" ? 0.4 : 0.8,
        max_tokens: mode === "roleplay" ? 400 : 2000,
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

    if (mode === "roleplay" || mode === "explain") {
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
