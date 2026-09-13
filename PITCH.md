[PITCH.md](https://github.com/user-attachments/files/32156484/PITCH.md)
# Presentation

Roughly 2 minutes 40 seconds. Times are guides, not rules. Read it out loud
three times before the day — the point is to stop reading it, not to memorise it.

---

## 1. Problem (~30 seconds)

> Everyone has a conversation they keep putting off.
>
> Asking for a raise. Telling a friend they hurt you. Quitting a job.
>
> We put them off because we get one attempt. There's no rehearsal. You walk in
> and improvise the most important conversation of your month, and then you spend
> the drive home thinking of what you should have said.
>
> Musicians rehearse. Athletes train. For the conversations that actually change
> our lives, we just wing it.
>
> So I built Rehearse.

Don't rush this part. It's the only thirty seconds where the room decides
whether they care.

---

## 2. Demo on the phone (~70 seconds)

Hold the phone up, or mirror it on screen. Narrate what you tap.

1. **Sign in.** "This is Supabase Auth. Real accounts, real passwords."
2. **Open a prepared scenario.** Have one already saved — do not type a form on
   stage. Say: "I set this one up earlier — I'm asking my manager for a raise, and
   I've told the app she's busy, avoids committing, and always says the budget is
   frozen."
3. **Let the AI open.** It speaks in character.
4. **Type one short reply.** Something deliberately weak, like "I was wondering if
   maybe there's any chance of a raise?"
5. **Let it push back.** It will. That's the moment the room gets it.
6. **Hit Finish and get feedback.** Show the score and the written critique.
7. **Open Past attempts.** "Everything is saved to my account. Only mine — I'll
   come back to that."

If the AI is slow, keep talking over it. Silence is what kills a demo, not latency.

---

## 3. Technologies (~40 seconds)

Have the architecture diagram on screen.

> Four pieces.
>
> The interface is plain HTML, CSS and JavaScript, hosted on Vercel.
>
> Authentication and the database are Supabase. Two tables — the conversations I
> set up, and every rehearsal I've finished.
>
> The important part is this line in the SQL: `auth.uid() = user_id`. That's Row
> Level Security. The database itself refuses to return rows that don't belong to
> whoever is asking. If someone got my public key, they still couldn't read your
> conversations.
>
> And the AI is Groq, called through a server function — not from the phone. If I
> called it from the browser, my API key would be sitting in the page source for
> anyone to steal.

That last sentence is worth saying even if nobody asks. It shows you understood
something rather than copied something.

---

## 4. Lessons learned (~25 seconds)

Use the real one:

> My first idea was to build this on top of Spotify's API. I spent an evening
> reading their documentation and found that new apps are limited to five
> authorised users, and the data endpoints I needed had been shut off in 2024.
>
> If I'd found that in October instead of September, I'd have had nothing to show
> you. So the lesson was to check what a third-party service actually permits
> before designing around it — and to build a demo mode that works when the
> network doesn't.

---

# Questions you will get

**"What stops me from seeing someone else's conversations?"**
Row Level Security in Postgres. Every table has a policy saying
`auth.uid() = user_id`. It's enforced by the database, not by my JavaScript — so
even a modified client can't get around it.

**"What happens if the AI is down?"**
Every AI call is wrapped in try/catch. The roleplay falls back to a visible message
instead of a blank screen, and finishing a rehearsal shows a toast rather than
crashing. The app stays usable.

**"Why not just practise with a friend?"**
You can, and you should. But a friend won't play your difficult manager honestly,
they won't do it at midnight, and you only get to be bad at it in front of someone
whose opinion you care about. This lets you be bad at it privately first.

**"Isn't this just ChatGPT with extra steps?"**
The value isn't the model, it's the structure around it: saved characters that stay
consistent, a scoring rubric applied the same way every time, and a record of
whether you're improving. You could do one rehearsal in a chatbot. You couldn't
track thirty.

**"Show me where the AI is called."**
`api/chat.js`, the `fetch` to `ENDPOINT` — around line 90. The two prompts are
directly above it in `roleplayPrompt` and `evaluatePrompt`.

**"Show me where login happens."**
`app.js`, section 1, `supabase.auth.signInWithPassword`.

**"What would you add next?"**
Voice input, so you rehearse out loud instead of typing — that's closer to the real
thing. And comparing your scores across attempts on the same scenario to show
whether you're actually getting better.

---

# The hour before

- Open the live URL on your own phone, on the venue's wifi. Not your home wifi.
- Sign in once so the session is warm.
- Have one scenario already created and one rehearsal already finished, so
  Past attempts isn't empty.
- Have the QR code on a slide, and test that it scans from where the audience sits.
- Screenshot the working app. If everything fails, you still have something to show.
