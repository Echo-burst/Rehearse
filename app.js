import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD } from "./config.js";
import { LANGUAGES, STRINGS } from "./i18n.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- app state -------------------------------------------------------------
let scenario = null;      // the conversation being rehearsed right now
let messages = [];        // [{ role: "user" | "assistant", content }]
let lang = "en";          // current interface language
let session = null;       // null means signed out

// ---- colours ---------------------------------------------------------------
// Three layers, most specific wins:
//   1. the user's own colours (saved on their account, only they see them)
//   2. the app-wide colours the admin sets for everyone
//   3. the original Rehearse scheme: green, orange and near-black
const ORIGINAL_THEME = {
  accent: "#6FE3B0",   // green
  them: "#E8B44A",     // orange
  bg: "#171C24",       // near-black
  surface: "#202832",
  ink: "#E9EBEF",
};
let siteTheme = { ...ORIGINAL_THEME };

// ---- tiny helpers ----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const t = (key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key;

// Screens reachable without an account. Everything else is gated.
const PUBLIC_VIEWS = ["auth", "signin", "signup", "reset"];

// True only between clicking the link in a reset email and saving a new password.
let recovering = false;

function show(name) {
  // The guard. Asking for an app screen while signed out sends you to the
  // welcome screen instead, so there is no way to browse past the login.
  if (recovering) name = "newpass";
  else {
    if (!session && !PUBLIC_VIEWS.includes(name)) name = "auth";

    // And the reverse: a signed-in user has no business on the login screens.
    if (session && PUBLIC_VIEWS.includes(name)) name = "menu";
  }

  if (name !== "theme" && name !== "admin") refreshTheme();

  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  const view = $("view-" + name);
  view.hidden = false;

  // Restart the entrance animation. Removing the class, forcing the browser to
  // recalculate layout, then re-adding it is what makes it replay every time.
  view.classList.remove("enter");
  void view.offsetWidth;
  view.classList.add("enter");

  const panel = $("account-panel");
  if (panel) panel.hidden = true;

  window.scrollTo(0, 0);
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => (el.hidden = true), 2600);
}

function showError(el, text) {
  el.textContent = text;
  el.hidden = !text;
}

function busy(button, isBusy, labelWhenBusy) {
  button.disabled = isBusy;
  if (isBusy) {
    button._key = button.dataset.t;
    button.textContent = labelWhenBusy;
  } else if (button._key) {
    button.textContent = t(button._key);
  }
}

// ============================================================================
// 0. LANGUAGE
// ============================================================================

function applyLanguage() {
  document.documentElement.lang = lang;

  // Elements with data-t get their visible text replaced.
  document.querySelectorAll("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t);
  });

  // Elements with data-tp get their placeholder replaced.
  document.querySelectorAll("[data-tp]").forEach((el) => {
    el.placeholder = t(el.dataset.tp);
  });
}

function setLanguage(next) {
  lang = STRINGS[next] ? next : "en";
  localStorage.setItem("lang", lang);
  applyLanguage();

  // Two pickers exist (welcome screen and menu); keep them showing the same value.
  document.querySelectorAll(".lang").forEach((sel) => (sel.value = lang));

  if ($("greet").textContent) updateGreeting();
}

function initLanguage() {
  const selects = document.querySelectorAll(".lang");

  for (const select of selects) {
    for (const [code, name] of Object.entries(LANGUAGES)) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name;
      select.appendChild(option);
    }
    select.addEventListener("change", () => setLanguage(select.value));
  }

  // Remembered choice first, otherwise the phone's own language, otherwise English.
  const saved = localStorage.getItem("lang");
  const browser = (navigator.language || "en").slice(0, 2);
  setLanguage(saved || (STRINGS[browser] ? browser : "en"));
}

initLanguage();

// ============================================================================
// 0b. WELCOME WINDOW
//
// Shown once. The flag in localStorage is what stops it reappearing.
// ============================================================================

if (!localStorage.getItem("introSeen")) {
  $("intro").hidden = false;
}

$("btn-intro").addEventListener("click", () => {
  const overlay = $("intro");
  overlay.classList.add("leaving");
  setTimeout(() => {
    overlay.hidden = true;
    overlay.classList.remove("leaving");
  }, 260);
  localStorage.setItem("introSeen", "1");
});

// ============================================================================
// 1. AUTHENTICATION  (Supabase Auth)
// ============================================================================

$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-signin");
  showError($("signin-error"), "");
  busy(btn, true, t("signingIn"));

  const { error } = await supabase.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });

  busy(btn, false);
  if (error) showError($("signin-error"), error.message);
});

$("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-signup");
  showError($("signup-error"), "");

  const name = $("su-name").value.trim();
  const email = $("su-email").value.trim();
  const password = $("su-password").value;
  if (!name || !email || password.length < 6) {
    showError($("signup-error"), t("errName"));
    return;
  }

  busy(btn, true, t("creating"));
  // The name is stored on the Supabase user record itself, under user_metadata,
  // so there is no extra table to keep in sync.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  busy(btn, false);

  if (error) showError($("signup-error"), error.message);
  else toast(t("accountCreated"));
});

$("btn-demo").addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (error) toast(error.message);
});

$("btn-signout").addEventListener("click", async () => {
  closePanel();
  await supabase.auth.signOut();
});

// Runs on page load and on every sign in / sign out.
supabase.auth.onAuthStateChange((event, nextSession) => {
  session = nextSession;

  // Arriving from a reset email: Supabase signs the user in with a temporary
  // session whose only purpose is setting a new password.
  if (event === "PASSWORD_RECOVERY") {
    recovering = true;
    updateAccount();
    show("newpass");
    return;
  }

  updateAccount();
  refreshTheme();

  if (session) {
    updateGreeting();
    updateAdminVisibility();
    show("menu");
  } else {
    show("auth");
  }
});

// ---- password reset -------------------------------------------------------

$("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-reset");
  showError($("reset-error"), "");
  busy(btn, true, t("sending"));

  const { error } = await supabase.auth.resetPasswordForEmail(
    $("reset-email").value.trim(),
    { redirectTo: window.location.origin }
  );

  busy(btn, false);
  if (error) showError($("reset-error"), error.message);
  else toast(t("resetSent"));
});

$("newpass-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-newpass");
  showError($("newpass-error"), "");
  busy(btn, true, t("saving"));

  const { error } = await supabase.auth.updateUser({
    password: $("new-password").value,
  });

  busy(btn, false);

  if (error) {
    showError($("newpass-error"), error.message);
    return;
  }

  recovering = false;
  toast(t("passUpdated"));
  updateGreeting();
  updateAdminVisibility();
  show("menu");
});

// The name pill in the bottom left corner.
function displayName() {
  if (!session) return "";
  const meta = session.user.user_metadata || {};
  // Accounts made before the name field existed fall back to their email.
  return meta.name || (session.user.email || "").split("@")[0];
}

function updateAccount() {
  if (!session) {
    $("account-panel").hidden = true;
    return;
  }

  const name = displayName();
  $("account-name").textContent = name;
  $("account-initial").textContent = (name[0] || "?").toUpperCase();
  $("account-email").textContent = session.user.email || "";
  $("account-rename").value = name;
}

// The average of this user's own scores. RLS means this query can only ever
// see their rows, so no filtering by user_id is needed here.
// Outline colour for an average score. Averages have decimals (6.5, 7.8), so
// each band runs up to the next one: 1-2.9, 3-4.9, 5-6.9, 7-7.9, 8-8.9, 9-9.9, 10.
function scoreColour(avg) {
  const n = Number(avg);
  if (!avg || !Number.isFinite(n) || n <= 0) return null;   // no score yet
  if (n < 3)  return "#DE2F2F";   // 1-2  red
  if (n < 5)  return "#D44811";   // 3-4  orange
  if (n < 7)  return "#F0E000";   // 5-6  yellow
  if (n < 8)  return "#C8F000";   // 7    yellow-green
  if (n < 9)  return "#9CF000";   // 8    light green
  if (n < 10) return "#73E639";   // 9    green
  return "#48D921";               // 10   deep green
}

// Outline only: the border and the number take the colour, the fill stays as it is.
function paintScore(box, number, avg) {
  const colour = scoreColour(avg);
  box.style.borderColor = colour || "";
  number.style.color = colour || "";
}

// An encouraging line that matches the score. Lower scores get the warmest,
// most motivating words; higher scores get something short and relaxed.
// Same bands as the outline colours: 1-2.9, 3-5.9, 6-7.9, 8-10.
function motivation(score) {
  const n = Number(score);
  if (!score || !Number.isFinite(n) || n <= 0) return "";
  const band = n < 3 ? "low" : n < 6 ? "mid" : n < 8 ? "good" : "top";
  const pool = (STRINGS[lang].motivate || STRINGS.en.motivate)[band];
  return pool[Math.floor(Math.random() * pool.length)];
}

function showMotivation(el, score) {
  const line = motivation(score);
  el.textContent = line;
  el.hidden = !line;
  el.style.borderLeftColor = scoreColour(score) || "";
}

async function loadAverage() {
  const { data, error } = await supabase
    .from("rehearsals")
    .select("score")
    .gt("score", 0);

  const value = $("account-avg");
  const label = $("account-avg-label");

  const box = value.closest(".panel-score");

  if (error || !data || data.length === 0) {
    value.textContent = "—";
    label.textContent = t("noAvg");
    paintScore(box, value, null);
    showMotivation($("account-motivation"), null);
    return;
  }

  const average = data.reduce((sum, row) => sum + row.score, 0) / data.length;
  value.textContent = average.toFixed(1);
  paintScore(box, value, average);
  showMotivation($("account-motivation"), average);
  label.textContent = t("yourAvg") + " · " + data.length;
}

// ---- account panel --------------------------------------------------------

function closePanel() {
  $("account-panel").hidden = true;
}

$("account").addEventListener("click", (e) => {
  e.stopPropagation();
  const panel = $("account-panel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    $("account-rename").value = displayName();
    loadAverage();
  }
});

// Clicking anywhere else closes it.
document.addEventListener("click", (e) => {
  if (!$("account-panel").contains(e.target)) closePanel();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

// UPDATE the name on the Supabase user record.
$("btn-rename").addEventListener("click", async () => {
  const name = $("account-rename").value.trim();
  if (!name) return;

  const btn = $("btn-rename");
  busy(btn, true, t("saving"));
  const { data, error } = await supabase.auth.updateUser({ data: { name } });
  busy(btn, false);

  if (error) {
    toast(t("errSave"));
    console.error(error);
    return;
  }

  session.user = data.user;
  updateAccount();
  updateGreeting();
  toast(t("savedName"));
  closePanel();
});

// ============================================================================
// 2. DATABASE  (read + write, scoped to the signed-in user by RLS)
// ============================================================================

async function loadScenarios() {
  const list = $("scenario-list");
  list.innerHTML = "";

  // Pinned conversations first, then newest first within each group.
  const { data, error } = await supabase
    .from("scenarios")
    .select("*")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    toast(t("errLoad"));
    console.error(error);
    return;
  }

  $("list-empty").hidden = data.length > 0;

  for (const row of data) {
    const card = document.createElement("article");
    card.className = "scenario" + (row.pinned ? " pinned" : "");
    card.innerHTML =
      '<button class="scenario-open"><h3></h3><p></p><p class="real-tag" hidden></p></button>' +
      '<div class="scenario-actions">' +
      '<button class="mini act-progress"></button>' +
      '<button class="mini act-pin"></button>' +
      '<button class="mini danger act-del"></button>' +
      "</div>";

    card.querySelector("h3").textContent = row.title;
    card.querySelector("p").textContent = t("with") + " " + row.counterpart;
    card.querySelector(".act-progress").textContent = t("progressBtn");
    card.querySelector(".act-pin").textContent = row.pinned ? t("unpin") : t("pin");

    const outcomeKey = OUTCOME_LABEL[row.real_outcome];
    if (outcomeKey && row.real_outcome !== "notyet") {
      const tag = card.querySelector(".real-tag");
      tag.textContent = t("realLogged") + " " + t(outcomeKey);
      tag.dataset.outcome = row.real_outcome;
      tag.hidden = false;
    }
    card.querySelector(".act-del").textContent = t("del");

    card.querySelector(".scenario-open").addEventListener("click", () => startRehearsal(row));
    card.querySelector(".act-progress").addEventListener("click", () => openProgress(row));
    card.querySelector(".act-pin").addEventListener("click", () => togglePin(row));
    card.querySelector(".act-del").addEventListener("click", () => deleteScenario(row));

    list.appendChild(card);
  }
}

// UPDATE: flip the pinned flag on one row.
async function togglePin(row) {
  const { error } = await supabase
    .from("scenarios")
    .update({ pinned: !row.pinned })
    .eq("id", row.id);

  if (error) {
    toast(t("errDelete"));
    console.error(error);
    return;
  }
  loadScenarios();
}

// DELETE: removing a scenario also removes its rehearsals, because the
// foreign key in supabase-schema.sql is declared "on delete cascade".
async function deleteScenario(row) {
  if (!confirm(t("confirmScenario"))) return;

  const { error } = await supabase.from("scenarios").delete().eq("id", row.id);

  if (error) {
    toast(t("errDelete"));
    console.error(error);
    return;
  }
  toast(t("removed"));
  loadScenarios();
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
    situation: $("s-situation").value.trim(),
    context: $("s-context").value.trim(),
    goal: $("s-goal").value.trim(),
    starter: document.querySelector('input[name="starter"]:checked')?.value || "them",
  };

  busy(btn, true, t("saving"));
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

  const { data, error } = await supabase
    .from("rehearsals")
    .select("id, score, feedback, created_at, scenarios(title, counterpart)")
    .order("created_at", { ascending: false });

  if (error) {
    toast(t("errHistory"));
    console.error(error);
    return;
  }

  $("history-empty").hidden = data.length > 0;

  for (const row of data) {
    const date = new Date(row.created_at).toLocaleDateString(lang, {
      day: "numeric",
      month: "short",
    });

    const item = document.createElement("article");
    item.className = "card history-item";
    item.innerHTML =
      '<div class="history-head"><span class="history-score"></span>' +
      '<span class="history-meta"><h3></h3><p class="muted small"></p></span>' +
      '<button class="mini danger act-del"></button></div>' +
      '<p class="history-feedback"></p>';

    const scoreEl = item.querySelector(".history-score");
    scoreEl.textContent = row.score || "—";
    paintScore(scoreEl, scoreEl, row.score);
    item.querySelector("h3").textContent = row.scenarios?.title || t("deleted");
    item.querySelector(".small").textContent =
      (row.scenarios?.counterpart ? t("with") + " " + row.scenarios.counterpart + " · " : "") + date;
    item.querySelector(".history-feedback").textContent = row.feedback || "";
    item.querySelector(".act-del").textContent = t("del");
    item.querySelector(".act-del").addEventListener("click", () => deleteRehearsal(row.id));

    list.appendChild(item);
  }
}

// DELETE one past rehearsal.
async function deleteRehearsal(id) {
  if (!confirm(t("confirmRehearsal"))) return;

  const { error } = await supabase.from("rehearsals").delete().eq("id", id);

  if (error) {
    toast(t("errDelete"));
    console.error(error);
    return;
  }
  toast(t("removed"));
  loadHistory();
}

// ============================================================================
// 3. AI API  (called through /api/chat so the provider key stays on the server)
// ============================================================================

async function callAI(mode, payload) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // `language` tells the AI which language to answer in.
    body: JSON.stringify({ mode, scenario, language: lang, ...payload }),
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
    const name = m.role === "user" ? t("you") : scenario.counterpart;
    const turn = document.createElement("div");
    turn.className = "turn " + who;
    turn.innerHTML = '<p class="who"></p><p class="said"></p>';
    turn.querySelector(".who").textContent = name;
    turn.querySelector(".said").textContent = m.content;
    box.appendChild(turn);
  }

  if (!pending && messages.length === 0) {
    const hint = document.createElement("p");
    hint.className = "turn-hint";
    hint.textContent = t("yourTurn");
    box.appendChild(hint);
  }

  if (pending) {
    const turn = document.createElement("div");
    turn.className = "turn them thinking";
    turn.innerHTML = '<p class="who"></p><p class="said"></p>';
    turn.querySelector(".who").textContent = scenario.counterpart;
    turn.querySelector(".said").textContent = t("thinking");
    box.appendChild(turn);
  }

  box.lastElementChild?.scrollIntoView({ block: "end" });
}

async function startRehearsal(row) {
  scenario = row;
  messages = [];
  $("support").hidden = !looksSerious([row.title, row.situation, row.context, row.goal].join(" "));
  $("rehearse-title").textContent = row.title + " · " + row.counterpart;
  show("rehearse");

  // The user chose to open: no AI call yet, just an empty transcript and a
  // prompt to go first. The AI's first message will be a reply to theirs.
  if (row.starter === "me") {
    renderTranscript(false);
    $("reply").focus();
    return;
  }

  renderTranscript(true);

  try {
    const { reply } = await callAI("roleplay", { messages: [] });
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    messages.push({ role: "assistant", content: t("unreachable") });
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
  if (looksSerious(text)) $("support").hidden = false;
  renderTranscript(true);
  busy($("btn-send"), true, t("sending"));

  try {
    const { reply } = await callAI("roleplay", { messages });
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    toast(t("errNoReply"));
    console.error(err);
  }

  busy($("btn-send"), false);
  renderTranscript(false);
});

$("btn-finish").addEventListener("click", async () => {
  if (messages.filter((m) => m.role === "user").length === 0) {
    toast(t("errSayFirst"));
    return;
  }

  const btn = $("btn-finish");
  busy(btn, true, t("reviewing"));

  try {
    const result = await callAI("evaluate", { messages });
    $("score").textContent = result.score;
    $("score-label").textContent = result.verdict;
    showMotivation($("score-motivation"), result.score);
    $("feedback-body").textContent = result.feedback;
    resetExplain(result);
    await saveRehearsal(result.score, result.feedback);
    show("feedback");
  } catch (err) {
    toast(t("errFeedback"));
    console.error(err);
  }

  busy(btn, false);
});

// ---- "why this score?" ----------------------------------------------------
// The coach explains the score it just gave, using the same transcript, and
// can answer follow-up questions about it. Nothing here is saved.

let lastResult = null;

function resetExplain(result) {
  lastResult = result;
  $("explain-thread").innerHTML = "";
  $("explain-thread").hidden = true;
  $("ask-form").hidden = true;
  $("ask-input").value = "";
  $("btn-why").hidden = !(result && Number(result.score) > 0);
}

function addExplainEntry(kind, text) {
  const thread = $("explain-thread");
  const p = document.createElement("p");
  p.className = "explain-" + kind;
  p.textContent = text;
  thread.appendChild(p);
  thread.hidden = false;
  return p;
}

async function askCoach(question) {
  if (!lastResult) return;
  if (question) addExplainEntry("question", question);
  const waiting = addExplainEntry("waiting", t("explaining"));

  try {
    const { reply } = await callAI("explain", {
      messages,
      score: lastResult.score,
      feedback: lastResult.feedback,
      question: question || "",
    });
    waiting.className = "explain-answer";
    waiting.textContent = reply;
    $("ask-form").hidden = false;
  } catch (err) {
    waiting.remove();
    toast(t("errExplain"));
    console.error(err);
  }
}

$("btn-why").addEventListener("click", async () => {
  const btn = $("btn-why");
  btn.hidden = true;
  await askCoach("");
  if ($("explain-thread").children.length === 0) btn.hidden = false;
});

$("ask-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("ask-input").value.trim();
  if (!q) return;
  $("ask-input").value = "";
  const btn = $("btn-ask");
  busy(btn, true, "…");
  await askCoach(q);
  busy(btn, false);
});

// ---- support for serious topics --------------------------------------------
// A gentle, local check for words that suggest someone may be unsafe or in
// crisis. It never blocks practice; it only shows where real help is. Nothing
// is sent anywhere because of it.

const SERIOUS = [
  // English
  /\b(hits?|hitting|beats?|beating|hurts?|hurting|kicks?|chokes?) me\b(?! up)/, /\bbeat me up\b/,
  /\babus(e|ed|er|ive|ing)\b/, /\bviolen(t|ce)\b/, /\bunsafe\b/, /\bnot safe\b/,
  /\b(afraid|scared|terrified) (of (him|her|them|my (dad|father|mom|mum|mother|husband|wife|partner|boyfriend|girlfriend|stepdad|stepmom))|to go home)\b/,
  /\bthreaten(s|ed|ing)? (me|to)\b/, /\bself[- ]?harm/, /\bsuicid/, /\bkill myself\b/,
  /\bwant(s)? to die\b/, /\bend (my|it all|my life)\b/, /\bcut(ting)? myself\b/,
  /\bsexual(ly)? (assault|abus|harass)/, /\brape(d)?\b/, /\bbull(ied|ying)\b/, /\bgroom(ed|ing) me\b/,
  // Russian
  /бь[её]т меня/, /избива/, /насили/, /угрожа/, /боюсь (его|её|ее|отца|мать|мужа|идти домой)/,
  /суицид/, /покончить с собой/, /хочу умереть/, /не хочу жить/, /самоповрежд/, /режу себя/,
  /травл/, /домогател/, /изнасил/,
  // Spanish
  /me (pega|golpea|maltrata|amenaza)/, /maltrat/, /violencia/, /tengo miedo de (él|ella|volver a casa)/,
  /suicid/, /quitarme la vida/, /quiero morir/, /autolesi/, /acoso/,
  // French
  /me (frappe|bat|menace)\b/, /maltrait/, /violence/, /peur de (lui|elle|rentrer)/,
  /me tuer/, /envie de mourir/, /automutil/, /harc[eè]lement/, /harcel/,
  // German
  /schl(ä|ae)gt mich/, /misshandel/, /missbrauch/, /gewalt/, /bedroht mich/, /angst vor (ihm|ihr)/,
  /angst,? nach hause/, /suizid/, /mich umbringen/, /sterben will/, /selbstverletz/, /mobbing/, /gemobbt/,
  // Kazakh
  /ұрады/, /соғады/, /зорлық/, /қорқытады/, /өзіме қол жұмса/, /өлгім келеді/, /қорлай/, /буллинг/,
];

function looksSerious(text) {
  const lower = String(text || "").toLowerCase();
  return SERIOUS.some((re) => re.test(lower));
}

$("btn-support-close").addEventListener("click", () => {
  $("support").hidden = true;
});

// ---- progress for one conversation -----------------------------------------

const OUTCOME_LABEL = { well: "outWell", mixed: "outMixed", bad: "outBad", notyet: "outNotYet" };
let progressRow = null;

async function openProgress(row) {
  progressRow = row;
  $("progress-name").textContent = row.title;
  $("progress-with").textContent = t("with") + " " + row.counterpart;
  $("progress-chart").innerHTML = "";
  $("progress-tiles").innerHTML = "";
  $("progress-trend").textContent = "";
  $("progress-empty").hidden = true;

  // the check-in form shows what they saved last time
  document.querySelectorAll('input[name="outcome"]').forEach((r) => (r.checked = r.value === row.real_outcome));
  $("real-note").value = row.real_note || "";

  show("progress");

  // READ: every finished attempt at this one conversation, oldest first.
  const { data, error } = await supabase
    .from("rehearsals")
    .select("score, created_at")
    .eq("scenario_id", row.id)
    .gt("score", 0)
    .order("created_at", { ascending: true });

  if (error) {
    toast(t("errHistory"));
    console.error(error);
    return;
  }

  if (!data.length) {
    $("progress-empty").hidden = false;
    return;
  }

  const scores = data.map((r) => r.score);
  drawChart($("progress-chart"), data);

  const first = scores[0];
  const latest = scores[scores.length - 1];
  const best = Math.max(...scores);
  const diff = latest - first;

  $("progress-trend").textContent =
    scores.length < 2 ? "" :
    diff > 0 ? t("trendUp").replace("{d}", "+" + diff) :
    diff < 0 ? t("trendDown").replace("{d}", Math.abs(diff)) :
    t("trendSame");
  $("progress-trend").dataset.dir = diff > 0 ? "up" : diff < 0 ? "down" : "same";

  for (const [key, value] of [["firstTry", first], ["latest", latest], ["best", best]]) {
    const tile = document.createElement("div");
    tile.className = "uc-tile uc-score";
    tile.innerHTML = '<span class="uc-num"></span><span class="uc-lab"></span>';
    tile.querySelector(".uc-num").textContent = value;
    tile.querySelector(".uc-lab").textContent = t(key);
    paintScore(tile, tile.querySelector(".uc-num"), value);
    $("progress-tiles").appendChild(tile);
  }
}

// A small line chart drawn as SVG: score 0-10 up the side, one point per
// attempt, each dot in its score colour.
function drawChart(box, rows) {
  // Drawn at roughly phone width so the numbers stay readable when it scales.
  const W = 340, H = 190, L = 26, R = 14, T = 24, B = 26;
  const n = rows.length;
  const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v) => T + ((10 - v) * (H - T - B)) / 10;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", rows.map((r) => r.score).join(", "));

  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    svg.appendChild(el);
    return el;
  };

  for (const v of [0, 2, 4, 6, 8, 10]) {
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
    add("text", { x: L - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, v);
  }

  if (n > 1) {
    add("polyline", { points: rows.map((r, i) => `${x(i)},${y(r.score)}`).join(" "), class: "trendline" });
  }

  // label the attempts along the bottom, thinning them out when there are many
  const step = Math.ceil(n / 8);
  rows.forEach((r, i) => {
    const colour = scoreColour(r.score) || "currentColor";
    add("circle", { cx: x(i), cy: y(r.score), r: 5, fill: colour, class: "dot" });
    add("text", { x: x(i), y: y(r.score) - 10, class: "dot-label", "text-anchor": "middle", fill: colour }, r.score);
    if (i % step === 0 || i === n - 1) {
      add("text", { x: x(i), y: H - 6, class: "axis", "text-anchor": "middle" }, i + 1);
    }
  });

  box.innerHTML = "";
  box.appendChild(svg);
}

// UPDATE: "How did the real one go?"
$("btn-real-save").addEventListener("click", async () => {
  if (!progressRow) return;
  const picked = document.querySelector('input[name="outcome"]:checked');
  if (!picked) return;

  const btn = $("btn-real-save");
  const update = {
    real_outcome: picked.value,
    real_note: $("real-note").value.trim(),
    real_at: new Date().toISOString(),
  };

  busy(btn, true, t("saving"));
  const { error } = await supabase.from("scenarios").update(update).eq("id", progressRow.id);
  busy(btn, false);

  if (error) {
    toast(t("errSave"));
    console.error(error);
    return;
  }

  Object.assign(progressRow, update);
  toast(t("realSaved"));
});

// ---- delete my account -----------------------------------------------------
// Two steps: the first tap arms the button, the second asks for a final
// confirmation. The database function only ever deletes the caller's own
// account, along with every conversation and rehearsal in it.

$("btn-delete-me").addEventListener("click", async (e) => {
  e.stopPropagation();
  const btn = $("btn-delete-me");

  if (!btn.dataset.armed) {
    btn.dataset.armed = "1";
    btn.textContent = t("deleteMineArmed");
    btn.classList.add("armed");
    btn._timer = setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = t("deleteMine");
      btn.classList.remove("armed");
    }, 5000);
    return;
  }

  clearTimeout(btn._timer);
  delete btn.dataset.armed;
  btn.classList.remove("armed");
  btn.textContent = t("deleteMine");

  if (!confirm(t("deleteMineConfirm"))) return;

  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    toast(t("errDelete"));
    console.error(error);
    return;
  }

  // The login no longer exists, so only clear it on this device.
  await supabase.auth.signOut({ scope: "local" });
  toast(t("deleteMineDone"));
});

// ---- my statistics ----------------------------------------------------------
// Everything here is read with the user's own login, and Row Level Security
// means the database only ever returns their rows. Nobody sees anyone else's.

// Resets the screen to "my statistics" mode (heading, back button, privacy note).
function statsMode(adminUser) {
  const back = $("stats-back");
  back.dataset.goto = adminUser ? "admin" : "menu";
  $("stats-heading").textContent = adminUser
    ? t("statsFor").replace("{name}", adminUser.name || (adminUser.email || "").split("@")[0])
    : t("myStats");
  $("stats-privacy").hidden = !adminUser;
  $("mystats-convos-title").hidden = !!adminUser;

  $("mystats-empty").hidden = true;
  $("mystats-body").hidden = true;
  for (const id of ["mystats-tiles", "mystats-chart", "mystats-real", "mystats-convos"]) $(id).innerHTML = "";
  $("mystats-trend").textContent = "";
}

async function loadMyStats() {
  statsMode(null);

  const [reh, scen] = await Promise.all([
    supabase.from("rehearsals").select("score, created_at, scenario_id").gt("score", 0).order("created_at", { ascending: true }),
    supabase.from("scenarios").select("id, title, counterpart, real_outcome, real_note, created_at").order("created_at", { ascending: false }),
  ]);

  if (reh.error || scen.error) {
    toast(t("errLoad"));
    console.error(reh.error || scen.error);
    return;
  }

  const count = (o) => scen.data.filter((s) => s.real_outcome === o).length;
  renderStats({
    rows: reh.data,
    conversations: scen.data.length,
    outcomes: { well: count("well"), mixed: count("mixed"), bad: count("bad") },
    convos: scen.data,
  });
}

// Admin: one person's numbers. The database function sends no titles, no
// transcripts and no feedback, so there is nothing private here to show.
async function openUserStats(user) {
  statsMode(user);
  show("stats");

  const { data, error } = await supabase.rpc("admin_user_stats", { target: user.id });
  if (error || !data) {
    toast(t("errLoad"));
    console.error(error);
    return;
  }

  renderStats({
    rows: data.scores,
    conversations: data.conversations,
    outcomes: { well: data.real_well, mixed: data.real_mixed, bad: data.real_bad },
    convos: null,
  });
}

function renderStats({ rows, conversations, outcomes, convos }) {
  if (!rows.length) {
    $("mystats-empty").hidden = false;
    return;
  }
  $("mystats-body").hidden = false;

  const scores = rows.map((r) => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  // headline numbers
  const tiles = [
    ["tileRehearsals", rows.length, null],
    ["tileConvos", conversations, null],
    ["tileAvg", avg.toFixed(1), avg],
    ["best", Math.max(...scores), Math.max(...scores)],
  ];
  for (const [key, value, colourBy] of tiles) {
    const tile = document.createElement("div");
    tile.className = "uc-tile" + (colourBy != null ? " uc-score" : "");
    tile.innerHTML = '<span class="uc-num"></span><span class="uc-lab"></span>';
    tile.querySelector(".uc-num").textContent = value;
    tile.querySelector(".uc-lab").textContent = t(key);
    if (colourBy != null) paintScore(tile, tile.querySelector(".uc-num"), colourBy);
    $("mystats-tiles").appendChild(tile);
  }

  // every score over time, and the change from the first to the latest
  drawChart($("mystats-chart"), rows);
  if (scores.length > 1) {
    const diff = scores[scores.length - 1] - scores[0];
    $("mystats-trend").textContent =
      diff > 0 ? t("trendUp").replace("{d}", "+" + diff) :
      diff < 0 ? t("trendDown").replace("{d}", Math.abs(diff)) : t("trendSame");
    $("mystats-trend").dataset.dir = diff > 0 ? "up" : diff < 0 ? "down" : "same";
  }

  // how the real conversations went
  for (const [key, value, cls] of [["outWell", outcomes.well, "good"], ["outMixed", outcomes.mixed, ""], ["outBad", outcomes.bad, ""]]) {
    const tile = document.createElement("div");
    tile.className = "uc-tile" + (cls ? " real-" + cls : "");
    tile.innerHTML = '<span class="uc-num"></span><span class="uc-lab"></span>';
    tile.querySelector(".uc-num").textContent = value;
    tile.querySelector(".uc-lab").textContent = t(key);
    $("mystats-real").appendChild(tile);
  }

  // one line per conversation - only for the person's own view
  if (!convos) return;
  for (const s of convos) {
    const mine = rows.filter((r) => r.scenario_id === s.id).map((r) => r.score);
    const a = mine.length ? mine.reduce((x, y) => x + y, 0) / mine.length : null;

    const card = document.createElement("article");
    card.className = "card stat-convo";
    card.innerHTML =
      '<div class="stat-convo-head"><div class="stat-convo-id"><h3></h3><p class="muted small"></p></div>' +
      '<span class="stat-convo-avg"></span></div>' +
      '<button class="mini act-progress"></button>';
    card.querySelector("h3").textContent = s.title;
    card.querySelector(".small").textContent = mine.length
      ? t("attemptsAvg").replace("{n}", mine.length).replace("{a}", a.toFixed(1))
      : t("with") + " " + s.counterpart;
    const badge = card.querySelector(".stat-convo-avg");
    badge.textContent = a == null ? "—" : a.toFixed(1);
    paintScore(badge, badge, a);
    const btn = card.querySelector(".act-progress");
    btn.textContent = t("progressBtn");
    btn.addEventListener("click", () => openProgress(s));
    $("mystats-convos").appendChild(card);
  }
}

// ============================================================================
// 5. NAVIGATION
// ============================================================================

document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => {
    const target = el.dataset.goto;
    show(target);

    if (target === "signin") showError($("signin-error"), "");
    if (target === "signup") showError($("signup-error"), "");
    if (target === "new") showError($("new-error"), "");
    if (target === "menu") updateGreeting();
    if (target === "list") loadScenarios();
    if (target === "history") loadHistory();
    if (target === "stats") loadMyStats();
    if (target === "admin") {
      loadAdmin();
      fillAdminPickers(currentTheme());
    }
    if (target === "theme") fillMyPickers(currentTheme());
  });
});

// ============================================================================
// 6. GREETING
// ============================================================================

function updateGreeting() {
  const hour = new Date().getHours();
  const part =
    hour < 5 ? "greetNight" :
    hour < 12 ? "greetMorning" :
    hour < 18 ? "greetAfternoon" :
    hour < 23 ? "greetEvening" : "greetNight";

  const taglines = ["tag1", "tag2", "tag3", "tag4"];
  const pick = taglines[Math.floor(Math.random() * taglines.length)];

  $("greet").textContent = t(part);
  $("greet-tag").textContent = t(pick);
}

// ============================================================================
// 7. INSTALLABILITY
//
// Registering the service worker is what lets a phone add the app to its home
// screen and open it without browser chrome.
// ============================================================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker did not register:", err);
    });
  });
}

// The service worker above is what keeps the app installable. Phones offer it
// through their own menu: "Install app" on Android, "Add to Home Screen" on iOS.

// ============================================================================
// 8. VOICE INPUT
//
// The Web Speech API is built into the browser, so there is no library and no
// API call. Chrome and Edge support it, including on Android. Safari's support
// is patchy, which is why the button hides itself when it is unavailable.
// ============================================================================

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_LOCALE = { en: "en-US", ru: "ru-RU", es: "es-ES", fr: "fr-FR", de: "de-DE", kk: "kk-KZ" };

let recognizer = null;
let listening = false;

if (SpeechRecognition) {
  $("btn-mic").hidden = false;

  $("btn-mic").addEventListener("click", () => {
    if (listening) {
      recognizer.stop();
      return;
    }

    recognizer = new SpeechRecognition();
    recognizer.lang = SPEECH_LOCALE[lang] || "en-US";
    recognizer.interimResults = true;
    recognizer.continuous = false;

    const before = $("reply").value;

    recognizer.addEventListener("start", () => {
      listening = true;
      $("btn-mic").classList.add("listening");
    });

    recognizer.addEventListener("result", (event) => {
      // Rebuild the whole transcript each time so interim guesses get replaced
      // rather than appended twice.
      let heard = "";
      for (const result of event.results) heard += result[0].transcript;
      $("reply").value = (before ? before + " " : "") + heard;
    });

    recognizer.addEventListener("error", (event) => {
      console.warn("Speech recognition:", event.error);
      if (event.error === "not-allowed") toast(t("micNo"));
    });

    recognizer.addEventListener("end", () => {
      listening = false;
      $("btn-mic").classList.remove("listening");
    });

    recognizer.start();
  });
}

// ============================================================================
// 9. APP-WIDE SETTINGS AND ADMIN
// ============================================================================

// ---- colour helpers -------------------------------------------------------

function toRgb(hex) {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
}

// Perceived brightness, 0 (black) to 1 (white).
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Blend two colours, amount 0 to 1.
function mix(a, b, amount) {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  const blend = (x, y) => Math.round(x + (y - x) * amount);
  return (
    "#" +
    [blend(r1, r2), blend(g1, g2), blend(b1, b2)]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

// Applies a theme to the whole page. Accent, background and text are set
// independently, so changing one never drags the others with it. The greys in
// between are derived so the admin only has to pick four colours.
function applyTheme({ accent, them, bg, surface, ink }) {
  const root = document.documentElement.style;

  root.setProperty("--you", accent);
  if (them) root.setProperty("--them", them);
  root.setProperty("--stage", bg);
  root.setProperty("--surface", surface);
  root.setProperty("--paper", ink);

  // Text drawn on the accent: black or white, whichever stays readable.
  root.setProperty("--accent-ink", luminance(accent) > 0.45 ? "#10161E" : "#FFFFFF");

  // Derived greys.
  root.setProperty("--surface-hi", mix(surface, ink, 0.09));
  root.setProperty("--line", mix(surface, ink, 0.2));
  root.setProperty("--muted", mix(ink, bg, 0.45));
}

// ---- app-wide settings ----------------------------------------------------

// Everyone reads the settings, so one admin change reaches every user.
async function loadSettings() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("wordmark, notice")
    .eq("id", 1)
    .single();

  if (error || !data) return;

  // Colours are personal now: everyone starts from the original scheme and
  // changes their own in "My colours". Only the name and notice are app-wide.
  siteTheme = { ...ORIGINAL_THEME };
  refreshTheme();
  document.querySelectorAll(".wordmark").forEach((el) => (el.textContent = data.wordmark));

  const notice = $("notice");
  notice.textContent = data.notice || "";
  notice.hidden = !data.notice;

  $("admin-wordmark").value = data.wordmark;
  $("admin-notice").value = data.notice || "";
}

loadSettings();

// ---- personal colours -----------------------------------------------------

function personalTheme() {
  return session?.user?.user_metadata?.theme || null;
}

function currentTheme() {
  return { ...siteTheme, ...(personalTheme() || {}) };
}

function refreshTheme() {
  applyTheme(currentTheme());
}

const MY_FIELDS = { accent: "my-accent", them: "my-them", bg: "my-bg", surface: "my-surface", ink: "my-ink" };

function fillMyPickers(theme) {
  for (const [key, id] of Object.entries(MY_FIELDS)) $(id).value = theme[key];
}

function readMyPickers() {
  const theme = {};
  for (const [key, id] of Object.entries(MY_FIELDS)) theme[key] = $(id).value;
  return theme;
}

// Preview live while dragging; nothing is saved until the button is pressed.
for (const id of Object.values(MY_FIELDS)) {
  $(id).addEventListener("input", () => applyTheme(readMyPickers()));
}

// Saved onto the user's own account (user_metadata), so the colours follow
// them to any device and nobody else ever sees them.
$("btn-theme-save").addEventListener("click", async () => {
  const btn = $("btn-theme-save");
  busy(btn, true, t("saving"));
  const { data, error } = await supabase.auth.updateUser({ data: { theme: readMyPickers() } });
  busy(btn, false);

  if (error) {
    toast(t("errSave"));
    console.error(error);
    return;
  }

  session.user = data.user;
  refreshTheme();
  toast(t("themeSaved"));
});

$("btn-theme-reset").addEventListener("click", async () => {
  const btn = $("btn-theme-reset");
  busy(btn, true, t("saving"));
  const { data, error } = await supabase.auth.updateUser({ data: { theme: null } });
  busy(btn, false);

  if (error) {
    toast(t("errSave"));
    console.error(error);
    return;
  }

  session.user = data.user;
  refreshTheme();
  fillMyPickers(currentTheme());
  toast(t("themeResetDone"));
});


// The admin card only appears for the account the database recognises. Hiding
// it is cosmetic; the admin functions re-check server side and refuse anyone else.
async function updateAdminVisibility() {
  if (!session) {
    $("nav-admin").hidden = true;
    return;
  }

  const { data, error } = await supabase.rpc("is_admin");
  $("nav-admin").hidden = !!error || data !== true;
}

async function loadAdmin() {
  loadStats();
  loadUsers();
}

async function loadStats() {
  const box = $("stats");
  box.innerHTML = "";

  const { data, error } = await supabase.rpc("admin_stats");

  if (error || !data) {
    toast(t("errLoad"));
    console.error(error);
    return;
  }

  const rows = [
    ["statUsers", data.users],
    ["statWeek", data.users_week],
    ["statToday", data.users_today],
    ["statActive", data.active_week],
    ["statScenarios", data.scenarios],
    ["statRehearsals", data.rehearsals],
    ["statAvg", data.avg_score ?? "—"],
    ["statReal", data.real_logged ?? 0],
    ["statWell", (data.real_well ?? 0) + (data.real_logged ? " (" + Math.round((100 * data.real_well) / data.real_logged) + "%)" : "")],
  ];

  for (const [key, value] of rows) {
    const cell = document.createElement("div");
    cell.className = "stat";
    cell.innerHTML = '<span class="stat-value"></span><span class="stat-label"></span>';
    cell.querySelector(".stat-value").textContent = value;
    cell.querySelector(".stat-label").textContent = t(key);
    box.appendChild(cell);
  }
}

// The account list. Deliberately no conversation content - names, activity and
// counts only, so usage is visible without reading anyone's private text.
async function loadUsers() {
  const list = $("user-list");
  list.innerHTML = "";

  const { data, error } = await supabase.rpc("admin_users");

  if (error || !data) {
    console.error(error);
    return;
  }

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short" }) : null;

  for (const user of data) {
    // Active means they have signed in within the last two weeks.
    const lastSeen = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null;
    const active = lastSeen && Date.now() - lastSeen.getTime() < 14 * 864e5;

    const name = user.name || (user.email || "").split("@")[0];
    const row = document.createElement("article");
    row.className = "card user-card" + (active ? " is-active" : "");
    row.innerHTML =
      '<div class="uc-head">' +
        '<span class="uc-avatar"></span>' +
        '<div class="uc-id"><h3></h3><p class="uc-email"></p></div>' +
        '<span class="uc-badge"></span>' +
      "</div>" +
      '<div class="uc-tiles">' +
        '<div class="uc-tile"><span class="uc-num n-convos"></span><span class="uc-lab l-convos"></span></div>' +
        '<div class="uc-tile"><span class="uc-num n-reh"></span><span class="uc-lab l-reh"></span></div>' +
        '<div class="uc-tile uc-score"><span class="uc-num n-avg"></span><span class="uc-lab l-avg"></span></div>' +
      "</div>" +
      '<div class="uc-foot">' +
        '<p class="uc-dates"></p>' +
        '<span class="uc-actions">' +
          '<button class="mini act-stats"></button>' +
          '<button class="mini danger act-del"></button>' +
        "</span>" +
      "</div>";

    row.querySelector(".uc-avatar").textContent = (name[0] || "?").toUpperCase();
    row.querySelector("h3").textContent = name;
    row.querySelector(".uc-email").textContent = user.email || "";
    row.querySelector(".uc-badge").textContent = active ? t("activeNow") : t("dormant");

    row.querySelector(".n-convos").textContent = user.scenarios;
    row.querySelector(".n-reh").textContent = user.rehearsals;
    row.querySelector(".n-avg").textContent = user.avg_score ?? "—";
    paintScore(row.querySelector(".uc-score"), row.querySelector(".n-avg"), user.avg_score);
    row.querySelector(".l-convos").textContent = t("tileConvos");
    row.querySelector(".l-reh").textContent = t("tileRehearsals");
    row.querySelector(".l-avg").textContent = t("tileAvg");

    const seen = lastSeen ? t("lastSeen") + " " + fmt(user.last_sign_in_at) : t("neverIn");
    row.querySelector(".uc-dates").textContent = t("joined") + " " + fmt(user.created_at) + " · " + seen;

    const statsBtn = row.querySelector(".act-stats");
    statsBtn.textContent = t("viewStats");
    statsBtn.addEventListener("click", () => openUserStats(user));

    const del = row.querySelector(".act-del");
    del.textContent = t("armDelete");
    del.addEventListener("click", () => armDelete(del, user));

    list.appendChild(row);
  }
}

// Two steps on purpose. The first tap only arms the button; the second asks for
// a final confirmation naming the account. It disarms itself after five seconds.
function armDelete(button, user) {
  if (!button.dataset.armed) {
    button.dataset.armed = "1";
    button.textContent = t("confirmArmed");
    button.classList.add("armed");

    button._timer = setTimeout(() => {
      delete button.dataset.armed;
      button.textContent = t("armDelete");
      button.classList.remove("armed");
    }, 5000);
    return;
  }

  clearTimeout(button._timer);
  delete button.dataset.armed;
  button.classList.remove("armed");
  button.textContent = t("armDelete");

  if (!confirm(t("confirmFinal") + "\n\n" + (user.email || ""))) return;

  deleteUser(user.id);
}

async function deleteUser(id) {
  const { error } = await supabase.rpc("admin_delete_user", { target: id });

  if (error) {
    toast(error.message);
    console.error(error);
    return;
  }

  toast(t("userDeleted"));
  loadStats();
  loadUsers();
}

// ---- admin colour pickers ---------------------------------------------------
// Same as "My colours": saved on the admin's own account, so they change how
// the app looks for the admin only. Everyone else keeps their own colours.

const ADMIN_FIELDS = { accent: "admin-accent", them: "admin-them", bg: "admin-bg", surface: "admin-surface", ink: "admin-ink" };

function fillAdminPickers(theme) {
  for (const [key, id] of Object.entries(ADMIN_FIELDS)) $(id).value = theme[key];
}

function readAdminPickers() {
  const theme = {};
  for (const [key, id] of Object.entries(ADMIN_FIELDS)) theme[key] = $(id).value;
  return theme;
}

// Live preview while dragging; nothing is saved until the button is pressed.
for (const id of Object.values(ADMIN_FIELDS)) {
  $(id).addEventListener("input", () => applyTheme(readAdminPickers()));
}

$("btn-admin-colours").addEventListener("click", async () => {
  const btn = $("btn-admin-colours");
  busy(btn, true, t("saving"));
  const { data, error } = await supabase.auth.updateUser({ data: { theme: readAdminPickers() } });
  busy(btn, false);

  if (error) {
    toast(t("errSave"));
    console.error(error);
    return;
  }

  session.user = data.user;
  refreshTheme();
  toast(t("themeSaved"));
});

// Puts the original green, orange and near-black into the pickers as a
// preview. Press "Save my colours" to keep it.
$("btn-admin-original").addEventListener("click", () => {
  fillAdminPickers(ORIGINAL_THEME);
  applyTheme(ORIGINAL_THEME);
});

$("btn-admin-save").addEventListener("click", async () => {
  const btn = $("btn-admin-save");
  showError($("admin-error"), "");
  busy(btn, true, t("saving"));

  const { error } = await supabase
    .from("app_settings")
    .update({
      wordmark: $("admin-wordmark").value.trim() || "Rehearse",
      notice: $("admin-notice").value.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  busy(btn, false);

  if (error) {
    showError($("admin-error"), error.message);
    return;
  }

  await loadSettings();
  toast(t("adminSaved"));
});
