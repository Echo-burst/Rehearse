import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- app state -------------------------------------------------------------
let scenario = null;      // the conversation being rehearsed right now
let messages = [];        // [{ role: "user" | "assistant", content }]

// ---- tiny helpers ----------------------------------------------------------
const $ = (id) => document.getElementById(id);

function show(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  $("view-" + name).hidden = false;
  window.scrollTo(0, 0);
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2600);
}

function showError(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function busy(button, isBusy, labelWhenBusy) {
  button.disabled = isBusy;
  if (isBusy) {
    button._label = button.textContent;
    button.textContent = labelWhenBusy;
  } else if (button._label) {
    button.textContent = button._label;
  }
}

// ============================================================================
// 1. AUTHENTICATION  (Supabase Auth)
// ============================================================================

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-signin");
  showError($("auth-error"), "");
  busy(btn, true, "Signing in…");

  const { error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });

  busy(btn, false);
  if (error) showError($("auth-error"), error.message);
});

$("btn-signup").addEventListener("click", async () => {
  const btn = $("btn-signup");
  showError($("auth-error"), "");

  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || password.length < 6) {
    showError($("auth-error"), "Enter an email and a password of at least 6 characters.");
    return;
  }

  busy(btn, true, "Creating…");
  const { error } = await supabase.auth.signUp({ email, password });
  busy(btn, false);

  if (error) showError($("auth-error"), error.message);
  else toast("Account created. You're signed in.");
});

$("btn-demo").addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (error) showError($("auth-error"), "Demo account unavailable: " + error.message);
});

$("btn-signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Runs on page load and on every sign in / sign out.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    show("list");
    loadScenarios();
  } else {
    show("auth");
  }
});

// ============================================================================
// 2. DATABASE  (read + write, scoped to the signed-in user by RLS)
// ============================================================================

async function loadScenarios() {
  const list = $("scenario-list");
  list.innerHTML = "";

  const { data, error } = await supabase
    .from("scenarios")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    toast("Could not load your conversations.");
    console.error(error);
    return;
  }

  $("list-empty").hidden = data.length > 0;

  for (const row of data) {
    const button = document.createElement("button");
    button.className = "scenario";
    button.innerHTML = `<h3></h3><p></p>`;
    button.querySelector("h3").textContent = row.title;
    button.querySelector("p").textContent = "with " + row.counterpart;
    button.addEventListener("click", () => startRehearsal(row));
    list.appendChild(button);
  }
}

$("scenario-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  showError($("new-error"), "");

  const { data: { user } } = await supabase.auth.getUser();

  const row = {
    user_id: user.id,
    title: $("s-title").value.trim(),
    counterpart: $("s-person").value.trim(),
    context: $("s-context").value.trim(),
    goal: $("s-goal").value.trim(),
  };

  busy(btn, true, "Saving…");
  const { data, error } = await supabase.from("scenarios").insert(row).select().single();
  busy(btn, false);

  if (error) {
    showError($("new-error"), error.message);
    return;
  }

  e.target.reset();
  startRehearsal(data);
});

async function saveRehearsal(score, feedback) {
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase.from("rehearsals").insert({
    user_id: user.id,
    scenario_id: scenario.id,
    transcript: messages,
    score,
    feedback,
  });

  if (error) console.error(error);
}

async function loadHistory() {
  const list = $("history-list");
  list.innerHTML = "";

  // Pulls each rehearsal together with the scenario it belongs to.
  const { data, error } = await supabase
    .from("rehearsals")
    .select("score, feedback, created_at, scenarios(title, counterpart)")
    .order("created_at", { ascending: false });

  if (error) {
    toast("Could not load your history.");
    console.error(error);
    return;
  }

  $("history-empty").hidden = data.length > 0;

  for (const row of data) {
    const date = new Date(row.created_at).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });

    const item = document.createElement("article");
    item.className = "card history-item";
    item.innerHTML = `
      <div class="history-head">
        <span class="history-score"></span>
        <span>
          <h3></h3>
          <p class="muted small"></p>
        </span>
      </div>
      <p class="history-feedback"></p>`;

    item.querySelector(".history-score").textContent = row.score ?? "—";
    item.querySelector("h3").textContent = row.scenarios?.title || "Deleted conversation";
    item.querySelector(".small").textContent =
      (row.scenarios?.counterpart ? "with " + row.scenarios.counterpart + " · " : "") + date;
    item.querySelector(".history-feedback").textContent = row.feedback || "";

    list.appendChild(item);
  }
}

// ============================================================================
// 3. AI API  (called through /api/chat so the provider key stays on the server)
// ============================================================================

async function callAI(mode, payload) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, scenario, ...payload }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error("AI request failed (" + response.status + "): " + detail);
  }

  return response.json();
}

// ============================================================================
// 4. REHEARSAL FLOW
// ============================================================================

function renderTranscript(pending) {
  const box = $("transcript");
  box.innerHTML = "";

  for (const m of messages) {
    const who = m.role === "user" ? "you" : "them";
    const name = m.role === "user" ? "You" : scenario.counterpart;
    const turn = document.createElement("div");
    turn.className = "turn " + who;
    turn.innerHTML = `<p class="who"></p><p class="said"></p>`;
    turn.querySelector(".who").textContent = name;
    turn.querySelector(".said").textContent = m.content;
    box.appendChild(turn);
  }

  if (pending) {
    const turn = document.createElement("div");
    turn.className = "turn them thinking";
    turn.innerHTML = `<p class="who"></p><p class="said">thinking…</p>`;
    turn.querySelector(".who").textContent = scenario.counterpart;
    box.appendChild(turn);
  }

  box.lastElementChild?.scrollIntoView({ block: "end" });
}

async function startRehearsal(row) {
  scenario = row;
  messages = [];
  $("rehearse-title").textContent = row.title + " · " + row.counterpart;
  show("rehearse");
  renderTranscript(true);

  try {
    const { reply } = await callAI("roleplay", { messages: [] });
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    messages.push({
      role: "assistant",
      content: "[The other person could not be reached. Check your AI key and try again.]",
    });
    console.error(err);
  }
  renderTranscript(false);
}

$("reply-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = $("reply").value.trim();
  if (!text) return;

  messages.push({ role: "user", content: text });
  $("reply").value = "";
  renderTranscript(true);
  busy($("btn-send"), true, "Sending…");

  try {
    const { reply } = await callAI("roleplay", { messages });
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    toast("The other person did not respond. Try again.");
    console.error(err);
  }

  busy($("btn-send"), false);
  renderTranscript(false);
});

$("btn-finish").addEventListener("click", async () => {
  if (messages.filter((m) => m.role === "user").length === 0) {
    toast("Say something first, then ask for feedback.");
    return;
  }

  const btn = $("btn-finish");
  busy(btn, true, "Reviewing…");

  try {
    const result = await callAI("evaluate", { messages });
    $("score").textContent = result.score;
    $("score-label").textContent = result.verdict;
    $("feedback-body").textContent = result.feedback;
    await saveRehearsal(result.score, result.feedback);
    show("feedback");
  } catch (err) {
    toast("Could not generate feedback.");
    console.error(err);
  }

  busy(btn, false);
});

// ============================================================================
// 5. NAVIGATION
// ============================================================================

$("btn-new").addEventListener("click", () => {
  showError($("new-error"), "");
  show("new");
});

$("btn-history").addEventListener("click", () => {
  show("history");
  loadHistory();
});

document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => {
    show(el.dataset.goto);
    if (el.dataset.goto === "list") loadScenarios();
  });
});
