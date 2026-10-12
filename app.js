import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { LANGUAGES, STRINGS } from "./i18n.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- app state -------------------------------------------------------------
let scenario = null;      // the conversation being rehearsed right now
let messages = [];        // [{ role: "user" | "assistant", content }]
let lang = "en";          // current interface language
let session = null;       // null means signed out
let energyBalance = 0;    // shown at the top; the database holds the real number
let isAdmin = false;
let energyUnlimited = false;  // switched on by the admin for their own account
let waitingForReply = false;

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

// Hooks up an event without letting one missing element break the whole app.
// If index.html and app.js ever get out of step, the rest still works and the
// console says exactly which piece is missing.
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn('Rehearse: no element with id "' + id + '" on the page. Is index.html up to date?');
    return;
  }
  el.addEventListener(event, handler);
}
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

// "How to earn and spend energy", drawn as chips so it reads clearly at any
// width. Used in the energy pop-up and on the "How ranks work" screen.
function renderEnergyGuides() {
  const rewards = [[6, 1], [7, 2], [8, 3], [9, 4], [10, 7]];
  document.querySelectorAll(".energy-guide").forEach((box) => {
    box.innerHTML = "";
    const lead = document.createElement("p");
    lead.className = "guide-line";
    lead.textContent = t("earnLead");
    box.appendChild(lead);

    const chips = document.createElement("div");
    chips.className = "reward-chips";
    for (const [score, gain] of rewards) {
      const chip = document.createElement("span");
      chip.className = "reward-chip";
      chip.innerHTML = '<b class="rc-score"></b><span class="rc-arrow">→</span><img src="energy.png" alt=""><b class="rc-gain"></b>';
      chip.querySelector(".rc-score").textContent = score;
      chip.querySelector(".rc-gain").textContent = "+" + gain;
      paintScore(chip.querySelector(".rc-score"), chip.querySelector(".rc-score"), score);
      chips.appendChild(chip);
    }
    box.appendChild(chips);

    const spendLead = document.createElement("p");
    spendLead.className = "guide-line";
    spendLead.textContent = t("spendLead");
    box.appendChild(spendLead);

    for (const [key, cost] of [["rewind", 5], ["hintBtn", 10]]) {
      const row = document.createElement("div");
      row.className = "spend-row";
      row.innerHTML = '<span></span><span class="spend-cost"><img src="energy.png" alt=""><b></b></span>';
      row.querySelector("span").textContent = t(key);
      row.querySelector("b").textContent = cost;
      box.appendChild(row);
    }
  });
}

function applyLanguage() {
  document.documentElement.lang = lang;

  // Elements with data-t get their visible text replaced.
  document.querySelectorAll("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t);
  });

  // Elements with data-t-aria get a translated label for screen readers.
  document.querySelectorAll("[data-t-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.tAria));
  });

  // Elements with data-tp get their placeholder replaced.
  document.querySelectorAll("[data-tp]").forEach((el) => {
    el.placeholder = t(el.dataset.tp);
  });
  renderEnergyGuides();
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

// Bump this whenever "What's new" changes, so everyone sees it once more.
const INTRO_VERSION = "2";
let introSeen = null;
try { introSeen = localStorage.getItem("introSeen"); } catch {}
if (introSeen !== INTRO_VERSION) {
  $("intro").hidden = false;
}

on("btn-intro", "click", () => {
  const overlay = $("intro");
  overlay.classList.add("leaving");
  setTimeout(() => {
    overlay.hidden = true;
    overlay.classList.remove("leaving");
  }, 260);
  try { localStorage.setItem("introSeen", INTRO_VERSION); } catch {}
});

// ============================================================================
// 1. AUTHENTICATION  (Supabase Auth)
// ============================================================================

on("signin-form", "submit", async (e) => {
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

on("signup-form", "submit", async (e) => {
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

on("btn-signout", "click", async () => {
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
    refreshEnergy().then(checkNewMessages);
    updateGreeting();
    updateAdminVisibility();
    show("menu");
  } else {
    show("auth");
  }
});

// ---- password reset -------------------------------------------------------

on("reset-form", "submit", async (e) => {
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

on("newpass-form", "submit", async (e) => {
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

on("account", "click", (e) => {
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
on("btn-rename", "click", async () => {
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
    card.dataset.search = [row.title, row.counterpart, row.situation, row.context, row.goal].join(" ");
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
  $("search-list").hidden = data.length < 2;
  applySearch("search-list", "scenario-list", "search-list-none");
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

on("scenario-form", "submit", async (e) => {
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

  if (error) {
    console.error(error);
    return;
  }

  // The database pays the energy out itself when the rehearsal is saved
  // (see migration-energy.sql). Here we only show it and refresh the number.
  const earned = energyReward(score);
  const line = $("score-energy");
  line.hidden = earned === 0;
  line.querySelector("span").textContent = t("earnedLong").replace("{n}", earned);
  if (earned > 0) toast(t("earned").replace("{n}", earned));
  refreshEnergy();
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
      '<p class="history-feedback"></p>' +
      '<button class="mini act-view"></button>';

    const scoreEl = item.querySelector(".history-score");
    scoreEl.textContent = row.score || "—";
    paintScore(scoreEl, scoreEl, row.score);
    item.querySelector("h3").textContent = row.scenarios?.title || t("deleted");
    item.querySelector(".small").textContent =
      (row.scenarios?.counterpart ? t("with") + " " + row.scenarios.counterpart + " · " : "") + date;
    item.querySelector(".history-feedback").textContent = row.feedback || "";
    item.querySelector(".act-del").textContent = t("del");
    item.querySelector(".act-del").addEventListener("click", () => deleteRehearsal(row.id));
    item.querySelector(".act-view").textContent = t("viewConvo");
    item.querySelector(".act-view").addEventListener("click", () => openTranscript(row.id));
    item.dataset.search = [row.scenarios?.title, row.scenarios?.counterpart, row.feedback, date].join(" ");

    list.appendChild(item);
  }
  $("search-history").hidden = data.length < 2;
  applySearch("search-history", "history-list", "search-history-none");
}

// ---- search in My conversations and Past attempts --------------------------
// Everything is already on screen, so we just hide cards that don't match.
// Case and accents don't matter, and every word you type has to appear.
const fold = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function applySearch(inputId, listId, noneId) {
  const input = $(inputId), list = $(listId), none = $(noneId);
  if (!input || !list) return;
  const words = fold(input.value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const card of list.children) {
    const hay = fold(card.dataset.search);
    const match = words.every((w) => hay.includes(w));
    card.hidden = !match;
    if (match) shown++;
  }
  if (none) none.hidden = !(words.length && shown === 0 && list.children.length);
}

on("search-list", "input", () => applySearch("search-list", "scenario-list", "search-list-none"));
on("search-history", "input", () => applySearch("search-history", "history-list", "search-history-none"));

// READ one saved rehearsal, exactly as it happened. Read-only: the screen has
// no inputs, and the transcript is only ever displayed, never written back.
async function openTranscript(id) {
  $("saved-transcript").innerHTML = "";
  $("saved-feedback").textContent = "";
  $("saved-title").textContent = "";
  $("saved-sub").textContent = "";
  $("saved-empty").hidden = true;
  show("transcript");

  const { data, error } = await supabase
    .from("rehearsals")
    .select("transcript, score, feedback, created_at, scenarios(title, counterpart)")
    .eq("id", id)
    .single();

  if (error || !data) {
    toast(t("errHistory"));
    console.error(error);
    return;
  }

  const other = data.scenarios?.counterpart || "";
  $("saved-title").textContent = data.scenarios?.title || t("deleted");
  $("saved-sub").textContent =
    (other ? t("with") + " " + other + " · " : "") +
    new Date(data.created_at).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  const score = $("saved-score");
  score.textContent = data.score || "—";
  paintScore(score, score, data.score);

  const turns = Array.isArray(data.transcript) ? data.transcript : [];
  $("saved-empty").hidden = turns.length > 0;
  for (const m of turns) {
    const mine = m.role === "user";
    const turn = document.createElement("div");
    turn.className = "turn " + (mine ? "you" : "them");
    turn.innerHTML = '<p class="who"></p><p class="said"></p>';
    turn.querySelector(".who").textContent = mine ? t("you") : other;
    turn.querySelector(".said").textContent = m.content;
    $("saved-transcript").appendChild(turn);
  }

  $("saved-feedback").textContent = data.feedback || "";
  $("saved-feedback-card").hidden = !data.feedback;
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
  $("hint-box").hidden = true;
  refreshEnergy();
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

on("reply-form", "submit", async (e) => {
  e.preventDefault();

  const text = $("reply").value.trim();
  if (!text) return;

  messages.push({ role: "user", content: text });
  $("reply").value = "";
  $("hint-box").hidden = true;
  if (looksSerious(text)) $("support").hidden = false;
  renderTranscript(true);
  busy($("btn-send"), true, t("sending"));
  waitingForReply = true;

  try {
    const { reply } = await callAI("roleplay", { messages });
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    toast(t("errNoReply"));
    console.error(err);
  }

  waitingForReply = false;
  busy($("btn-send"), false);
  renderTranscript(false);
});

on("btn-finish", "click", async () => {
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
    $("score-energy").hidden = true;
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

on("btn-why", "click", async () => {
  const btn = $("btn-why");
  btn.hidden = true;
  await askCoach("");
  if ($("explain-thread").children.length === 0) btn.hidden = false;
});

on("ask-form", "submit", async (e) => {
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

on("btn-support-close", "click", () => {
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
on("btn-real-save", "click", async () => {
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

on("btn-delete-me", "click", async (e) => {
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

// ---- energy -----------------------------------------------------------------
// Earned by scoring 6 or more, spent on Rewind (5) and "What could I say now?"
// (10). The balance lives in the database and users can't edit it: earning
// happens in a database trigger, spending in spend_energy(), and only the
// admin can give or take it directly.

const COST = { rewind: 5, hint: 10 };

function energyReward(score) {
  const n = Number(score) || 0;
  return n >= 10 ? 7 : n === 9 ? 4 : n === 8 ? 3 : n === 7 ? 2 : n === 6 ? 1 : 0;
}

function canAfford(action) {
  return energyUnlimited || energyBalance >= COST[action];
}

function paintEnergy() {
  const shown = energyUnlimited ? "∞" : energyBalance;
  document.querySelectorAll(".energy-num").forEach((el) => (el.textContent = shown));
  const inf = $("btn-self-inf");
  if (inf) {
    inf.textContent = energyUnlimited ? t("unlimitedOff") : t("unlimitedOn");
    inf.classList.toggle("on", energyUnlimited);
  }
  // dim a tool when you can't afford it (it still explains why when tapped)
  $("btn-rewind")?.classList.toggle("cant", !canAfford("rewind"));
  $("btn-hint")?.classList.toggle("cant", !canAfford("hint"));
  paintRank();
}

async function refreshEnergy() {
  if (!session) return;
  const { data, error } = await supabase.rpc("my_energy_info");
  if (error) {
    console.error(error);
    return;
  }
  energyBalance = data?.balance ?? 0;
  energyUnlimited = !!data?.unlimited;
  paintEnergy();
}

// Asks the database to take the cost. It refuses if the balance is too low,
// so nobody can go negative even by tampering with the page.
async function spend(action) {
  const { data, error } = await supabase.rpc("spend_energy", { action });
  if (error) {
    toast(/not enough/i.test(error.message) ? t("notEnough") : t("errSave"));
    console.error(error);
    refreshEnergy();
    return false;
  }
  energyBalance = data;
  paintEnergy();
  return true;
}

// tapping the counter explains how energy works
document.querySelectorAll(".energy-pill").forEach((pill) =>
  pill.addEventListener("click", (e) => {
    e.stopPropagation();
    $("energy-help").hidden = !$("energy-help").hidden;
  })
);
document.addEventListener("click", (e) => {
  const help = $("energy-help");
  if (help && !help.contains(e.target)) help.hidden = true;
});

// REWIND (5): takes back your last message and the reply to it, and puts your
// words back in the box so you can say it differently.
on("btn-rewind", "click", async () => {
  if (waitingForReply) return;

  let last = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { last = i; break; }
  }
  if (last === -1) {
    toast(t("nothingToRewind"));
    return;
  }
  if (!canAfford("rewind")) {
    toast(t("notEnough"));
    return;
  }

  const btn = $("btn-rewind");
  btn.disabled = true;
  const ok = await spend("rewind");
  btn.disabled = false;
  if (!ok) return;

  const removed = messages.splice(last);
  $("reply").value = removed[0].content;
  $("hint-box").hidden = true;
  renderTranscript(false);
  $("reply").focus();
  toast(t("rewound"));
});

// WHAT COULD I SAY NOW? (10): the coach suggests one next line. The energy is
// only taken once a suggestion has actually arrived.
on("btn-hint", "click", async () => {
  if (waitingForReply) return;
  if (!canAfford("hint")) {
    toast(t("notEnough"));
    return;
  }

  const box = $("hint-box");
  const btn = $("btn-hint");
  $("hint-text").textContent = t("hintThinking");
  $("btn-use-hint").hidden = true;
  box.hidden = false;
  btn.disabled = true;

  try {
    const { reply } = await callAI("hint", { messages });
    // never charge for an empty suggestion
    if (!reply || !reply.trim()) throw new Error("Empty hint");
    const paid = await spend("hint");
    if (!paid) {
      box.hidden = true;
    } else {
      $("hint-text").textContent = reply;
      $("btn-use-hint").hidden = false;
    }
  } catch (err) {
    box.hidden = true;
    toast(t("errHint"));
    console.error(err);
  }

  btn.disabled = false;
});

on("btn-use-hint", "click", () => {
  $("reply").value = $("hint-text").textContent;
  $("hint-box").hidden = true;
  $("reply").focus();
});

// ADMIN: energy for everyone at once
async function changeEnergyForAll(sign) {
  const amount = Math.abs(parseInt($("energy-all-amount").value, 10) || 0);
  if (!amount) return;
  const question = (sign > 0 ? t("confirmGiveAll") : t("confirmTakeAll")).replace("{n}", amount);
  if (!confirm(question)) return;

  const { error } = await supabase.rpc("admin_change_energy_all", { delta: sign * amount });
  if (error) {
    toast(error.message);
    console.error(error);
    return;
  }
  toast(t("energyUpdated"));
  refreshEnergy();
  loadUsers();
}
on("btn-energy-give-all", "click", () => changeEnergyForAll(+1));

// ADMIN: your own energy, right in the "Energy for everyone" card
async function changeMyEnergy(fn, args) {
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    toast(error.message);
    console.error(error);
    return;
  }
  await refreshEnergy();
  loadUsers();   // keep your account card below in step
  toast(t("energyUpdated"));
}

const selfAmount = () => Math.abs(parseInt($("self-amount").value, 10) || 0);

on("btn-self-give", "click", () => {
  const amount = selfAmount();
  if (amount) changeMyEnergy("admin_change_energy", { target: session.user.id, delta: amount });
});
on("btn-self-set", "click", () => {
  if ($("self-amount").value === "") return;
  changeMyEnergy("admin_set_energy", { target: session.user.id, amount: selfAmount() });
});
on("btn-self-inf", "click", () =>
  changeMyEnergy("admin_set_unlimited", { turn_on: !energyUnlimited })
);

// ---- ranks -----------------------------------------------------------------
// Your rank follows your current energy. Unlimited energy (∞) counts as the
// top rank. Below 40 energy you are unranked. Rank names stay the same in
// every language, like titles in a game.

const RANKS = [
  { min: 40,  max: 45,  family: "bronze",    name: "Bronze I" },
  { min: 46,  max: 50,  family: "bronze",    name: "Bronze II" },
  { min: 51,  max: 55,  family: "bronze",    name: "Bronze III" },
  { min: 56,  max: 60,  family: "silver",    name: "Silver I" },
  { min: 61,  max: 65,  family: "silver",    name: "Silver II" },
  { min: 66,  max: 70,  family: "silver",    name: "Silver III" },
  { min: 71,  max: 75,  family: "gold",      name: "Gold I" },
  { min: 76,  max: 80,  family: "gold",      name: "Gold II" },
  { min: 81,  max: 85,  family: "gold",      name: "Gold III" },
  { min: 86,  max: 90,  family: "diamond",   name: "Diamond I" },
  { min: 91,  max: 95,  family: "diamond",   name: "Diamond II" },
  { min: 96,  max: 99,  family: "diamond",   name: "Diamond III" },
  { min: 100, max: 110, family: "platinum",  name: "Platinum I" },
  { min: 111, max: 120, family: "platinum",  name: "Platinum II" },
  { min: 121, max: 130, family: "platinum",  name: "Platinum III" },
  { min: 131, max: 149, family: "platinum",  name: "Platinum IV" },
  { min: 150, max: 200, family: "elite",     name: "Elite",     bold: true },
  { min: 201, max: 300, family: "ascendant", name: "Ascendant", bold: true },
  { min: 301, max: 499, family: "ethereal",  name: "Ethereal",  bold: true },
  { min: 500, max: Infinity, family: "oblivion", name: "Oblivion", bold: true },
];

function rankFor(balance, unlimited) {
  if (unlimited) return RANKS[RANKS.length - 1];
  return RANKS.find((r) => balance >= r.min && balance <= r.max) || null;
}

// Fills an element made of <img> + <span> with a rank, or hides it.
function showRank(el, rank) {
  if (!el) return;
  el.hidden = !rank;
  if (!rank) return;
  el.className = el.className.replace(/\brank-(?!chip\b)\w+\b/g, "").trim() + " rank-" + rank.family;
  el.classList.toggle("rank-bold", !!rank.bold);
  el.querySelector("img").src = "rank-" + rank.family + ".png";
  el.querySelector("span").textContent = rank.name;
}

// Ranks are a secret until someone reaches Platinum I (100 energy). From then
// on they stay visible for that person, even if they spend energy later.
const UNLOCK_AT = 100;
let unlockSaving = false;

function ranksUnlocked() {
  if (energyUnlimited || energyBalance >= UNLOCK_AT) return true;
  return !!(session && session.user.user_metadata && session.user.user_metadata.ranksUnlocked);
}

async function rememberUnlock() {
  const meta = (session && session.user.user_metadata) || {};
  if (!session || meta.ranksUnlocked || unlockSaving) return;
  unlockSaving = true;
  const { data, error } = await supabase.auth.updateUser({ data: { ranksUnlocked: true } });
  unlockSaving = false;
  if (error) { console.error(error); return; }
  if (data && data.user) session.user = data.user;
  // only celebrate when it's a real rank-up, not for the admin's ∞
  if (!energyUnlimited) toast(t("ranksUnlocked").replace("{rank}", rankFor(energyBalance, false)?.name || "Platinum I"));
}

function paintRank() {
  const unlocked = ranksUnlocked();
  if (energyBalance >= UNLOCK_AT || energyUnlimited) rememberUnlock();
  const rank = unlocked ? rankFor(energyBalance, energyUnlimited) : null;

  // nothing about ranks shows until they are unlocked
  const panelRank = $("panel-rank");
  if (panelRank) panelRank.hidden = !unlocked;

  // under the name on the profile button
  showRank($("account-rank"), rank);

  // in the profile panel
  const img = $("panel-rank-img");
  const name = $("panel-rank-name");
  const next = $("panel-rank-next");
  if (img && name && next) {
    img.hidden = !rank;
    if (rank) img.src = "rank-" + rank.family + ".png";
    name.textContent = rank ? rank.name : t("unranked");
    name.className = "rank-name" + (rank ? " rank-" + rank.family + (rank.bold ? " rank-bold" : "") : " muted");
    const i = rank ? RANKS.indexOf(rank) : -1;
    const upcoming = RANKS[i + 1];
    next.textContent = !rank ? t("unrankedHint")
      : !upcoming ? t("topRank")
      : t("nextRank").replace("{rank}", upcoming.name).replace("{n}", upcoming.min);
  }

  // reviews: Elite and every rank above it
  const reviewBtn = $("btn-review");
  if (reviewBtn) reviewBtn.hidden = !(rank && RANKS.indexOf(rank) >= RANKS.findIndex((r) => r.family === "elite"));

  // the Extras tab appears only for Oblivion
  const extras = $("btn-extras");
  if (extras) extras.hidden = !(rank && rank.family === "oblivion");
}

// The full ladder, shown on the Extras screen
function renderRankLadder(box = $("rank-ladder")) {
  if (!box) return;
  box.innerHTML = "";
  const mine = rankFor(energyBalance, energyUnlimited);
  for (const r of RANKS) {
    const row = document.createElement("div");
    row.className = "ladder-row" + (r === mine ? " is-you" : "");
    row.innerHTML = '<img alt=""><span class="rank-name"></span><span class="ladder-range"></span>';
    row.querySelector("img").src = "rank-" + r.family + ".png";
    const nm = row.querySelector(".rank-name");
    nm.textContent = r.name;
    nm.classList.add("rank-" + r.family);
    if (r.bold) nm.classList.add("rank-bold");
    row.querySelector(".ladder-range").textContent =
      (r === mine ? t("youAreHere") + " · " : "") + (r.max === Infinity ? r.min + "+" : r.min + "–" + r.max);
    box.appendChild(row);
  }
}

// ---- messages to Oblivion ---------------------------------------------------
// One-way: the admin writes, Oblivion players read. The database decides who
// may read (only people at Oblivion right now) and who may write (only the
// admin), so hiding buttons here is just tidiness, not the protection.

const fmtWhen = (iso) =>
  new Date(iso).toLocaleString(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function dmBubble(msg, opts = {}) {
  const el = document.createElement("article");
  el.className = "dm" + (opts.isNew ? " is-new" : "");
  el.innerHTML = '<p class="dm-meta"><span class="dm-to-label"></span><span class="dm-time"></span></p><p class="dm-body"></p>';
  el.querySelector(".dm-to-label").textContent = opts.toLabel;
  el.querySelector(".dm-time").textContent = fmtWhen(msg.created_at) + (opts.isNew ? " · " + t("dmNew") : "");
  el.querySelector(".dm-body").textContent = msg.body;
  return el;
}

// Oblivion player: read the inbox on the Extras screen
async function loadInbox() {
  const list = $("dm-list");
  if (!list) return;
  list.innerHTML = "";

  const { data, error } = await supabase
    .from("oblivion_messages")
    .select("id, recipient, body, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error(error);
    return;
  }

  let lastSeen = "";
  try { lastSeen = localStorage.getItem("dmSeen") || ""; } catch {}

  // The admin can read every message (to manage them), but their own inbox
  // should only show what was meant for everyone or for them.
  const mine = data.filter((m) => !m.recipient || (session && m.recipient === session.user.id));

  $("dm-empty").hidden = mine.length > 0;
  for (const msg of mine) {
    list.appendChild(dmBubble(msg, {
      toLabel: msg.recipient ? t("dmToYou") : t("dmToAll"),
      isNew: msg.created_at > lastSeen,
    }));
  }

  // mark everything as read
  try { if (mine[0]) localStorage.setItem("dmSeen", mine[0].created_at); } catch {}
  $("extras-dot").hidden = true;
}

// A dot on the Extras button when there's something unread
async function checkNewMessages() {
  const dot = $("extras-dot");
  if (!dot || $("btn-extras").hidden) return;
  const { data, error } = await supabase
    .from("oblivion_messages").select("recipient, created_at").order("created_at", { ascending: false }).limit(20);
  const mine = (data || []).filter((m) => !m.recipient || (session && m.recipient === session.user.id));
  if (error || !mine.length) { dot.hidden = true; return; }
  let lastSeen = "";
  try { lastSeen = localStorage.getItem("dmSeen") || ""; } catch {}
  dot.hidden = !(mine[0].created_at > lastSeen);
}

// Admin: who can receive messages (everyone at Oblivion right now)
let oblivionPeople = [];
let adminUserCache = [];

function fillRecipients(users) {
  const select = $("dm-to");
  if (!select) return;
  const keep = select.value;
  oblivionPeople = users.filter(
    (u) => (u.unlimited || (u.energy ?? 0) >= 500) && !(session && u.id === session.user.id)
  );
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = t("dmAll");
  select.appendChild(all);
  for (const u of oblivionPeople) {
    const o = document.createElement("option");
    o.value = u.id;
    o.textContent = (u.name || u.email.split("@")[0]) + " — " + u.email;
    select.appendChild(o);
  }
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  $("dm-note").hidden = oblivionPeople.length > 0;
}

async function loadSentMessages() {
  const box = $("dm-sent");
  if (!box) return;
  box.innerHTML = "";
  const { data, error } = await supabase
    .from("oblivion_messages")
    .select("id, recipient, body, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) { console.error(error); return; }

  const nameOf = (id) => {
    const u = oblivionPeople.find((p) => p.id === id) || adminUserCache.find((p) => p.id === id);
    return u ? (u.name || u.email) : "?";
  };

  for (const msg of data) {
    const el = dmBubble(msg, { toLabel: msg.recipient ? "→ " + nameOf(msg.recipient) : "→ " + t("dmAll") });
    const del = document.createElement("button");
    del.className = "mini danger dm-del";
    del.textContent = t("del");
    del.addEventListener("click", async () => {
      if (!confirm(t("dmDeleteConfirm"))) return;
      const { error } = await supabase.from("oblivion_messages").delete().eq("id", msg.id);
      if (error) { toast(error.message); return; }
      el.remove();
    });
    el.querySelector(".dm-meta").appendChild(del);
    box.appendChild(el);
  }
}

// The admin's own "Messages to Oblivion" screen: who can receive + what was sent
async function loadDmView() {
  const { data, error } = await supabase.rpc("admin_users");
  if (error) { console.error(error); toast(error.message); return; }
  adminUserCache = data || [];
  fillRecipients(adminUserCache);
  loadSentMessages();
}

on("btn-dm-send", "click", async () => {
  const body = $("dm-body").value.trim();
  if (!body) return;
  const btn = $("btn-dm-send");
  busy(btn, true, t("sending"));
  const { error } = await supabase.from("oblivion_messages").insert({
    recipient: $("dm-to").value || null,
    body,
  });
  busy(btn, false);
  if (error) {
    toast(error.message);
    console.error(error);
    return;
  }
  $("dm-body").value = "";
  toast(t("dmSent"));
  loadSentMessages();
});

// ---- reviews ---------------------------------------------------------------
// Players at Elite or higher can send a review. The database fills in who sent
// it (email + name from their account) and only lets the admin read them.

let reviewStars = 0;

function paintStars(box, n) {
  box.querySelectorAll(".star").forEach((s) => s.classList.toggle("on", Number(s.dataset.star) <= n));
}

function resetReview() {
  reviewStars = 0;
  paintStars($("review-stars"), 0);
  $("review-body").value = "";
  showError($("review-error"), "");
}

document.querySelectorAll("#review-stars .star").forEach((s) =>
  s.addEventListener("click", () => {
    reviewStars = Number(s.dataset.star);
    paintStars($("review-stars"), reviewStars);
    showError($("review-error"), "");
  })
);

on("btn-review-send", "click", async () => {
  const body = $("review-body").value.trim();
  if (!reviewStars) { showError($("review-error"), t("reviewNeedStars")); return; }
  if (!body) { showError($("review-error"), t("reviewNeedText")); return; }
  const btn = $("btn-review-send");
  busy(btn, true, t("sending"));
  const { error } = await supabase.from("reviews").insert({ stars: reviewStars, body });
  busy(btn, false);
  if (error) {
    console.error(error);
    showError($("review-error"), /row-level security/i.test(error.message) ? t("reviewNotElite") : error.message);
    return;
  }
  resetReview();
  toast(t("reviewThanks"));
  show("menu");
});

// Admin: how many reviews, shown on the Admin button
async function countReviews() {
  const el = $("reviews-count");
  if (!el) return;
  const { count, error } = await supabase.from("reviews").select("id", { count: "exact", head: true });
  el.textContent = !error && count ? "(" + count + ")" : "";
}

// Admin: read every review, with who sent it
async function loadReviews() {
  const list = $("reviews-list");
  list.innerHTML = "";
  const { data, error } = await supabase
    .from("reviews")
    .select("id, email, name, stars, body, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) { console.error(error); toast(error.message); return; }

  $("reviews-empty").hidden = data.length > 0;
  const avgEl = $("reviews-avg");
  avgEl.hidden = !data.length;
  if (data.length) {
    const avg = data.reduce((s, r) => s + r.stars, 0) / data.length;
    avgEl.textContent = t("reviewsAvg").replace("{avg}", avg.toFixed(1)).replace("{n}", data.length);
  }

  for (const r of data) {
    const card = document.createElement("article");
    card.className = "card review-item";
    card.innerHTML =
      '<div class="ri-head"><span class="ri-stars"></span><span class="ri-time"></span></div>' +
      '<div class="ri-from" style="display:flex;flex-direction:column;gap:5px;margin:4px 0 2px">' +
        '<div class="ri-name" style="font-size:19px;font-weight:400;line-height:1.25"></div>' +
        '<div class="ri-email" style="font-size:12.5px;line-height:1.3;opacity:.75"></div>' +
      "</div>" +
      '<p class="ri-body"></p>';
    card.querySelector(".ri-stars").textContent = "★".repeat(r.stars) + "☆".repeat(5 - r.stars);
    card.querySelector(".ri-time").textContent = fmtWhen(r.created_at);
    card.querySelector(".ri-body").textContent = r.body;
    card.querySelector(".ri-name").textContent = r.name || (r.email || "").split("@")[0];
    card.querySelector(".ri-email").textContent = r.email || "";

    const del = document.createElement("button");
    del.className = "mini danger ri-del";
    del.textContent = t("del");
    del.addEventListener("click", async () => {
      if (!confirm(t("reviewDeleteConfirm"))) return;
      const { error } = await supabase.from("reviews").delete().eq("id", r.id);
      if (error) { toast(error.message); return; }
      loadReviews();
      countReviews();
    });
    card.querySelector(".ri-head").appendChild(del);
    list.appendChild(card);
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
    if (target === "menu") {
      updateGreeting();
      refreshEnergy().then(checkNewMessages);
    }
    if (target === "list") loadScenarios();
    if (target === "history") loadHistory();
    if (target === "stats") loadMyStats();
    if (target === "extras") {
      renderRankLadder();
      loadInbox();
    }
    if (target === "ranks") renderRankLadder($("rank-ladder-guide"));
    if (target === "dm") loadDmView();
    if (target === "review") resetReview();
    if (target === "reviews") loadReviews();
    if (target === "accounts") loadUsers();
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

  on("btn-mic", "click", () => {
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
  on(id, "input", () => applyTheme(readMyPickers()));
}

// Saved onto the user's own account (user_metadata), so the colours follow
// them to any device and nobody else ever sees them.
on("btn-theme-save", "click", async () => {
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

on("btn-theme-reset", "click", async () => {
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
    isAdmin = false;
    $("nav-admin").hidden = true;
    return;
  }

  const { data, error } = await supabase.rpc("is_admin");
  isAdmin = !error && data === true;
  $("nav-admin").hidden = !isAdmin;
  paintEnergy();
}

async function loadAdmin() {
  loadStats();
  loadUsers();   // fills the account count on the Admin button
  countReviews();
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
// Accounts screen: a compact list you can search, filter and sort. Each row
// opens to show the numbers, energy controls, statistics and delete.
let allUsers = [];
let accFilter = "all";

const isActiveUser = (u) => u.last_sign_in_at && Date.now() - new Date(u.last_sign_in_at).getTime() < 14 * 864e5;

async function loadUsers() {
  const { data, error } = await supabase.rpc("admin_users");

  if (error || !data) {
    console.error(error);
    return;
  }

  allUsers = data;
  adminUserCache = data;
  fillRecipients(data);
  const count = $("accounts-count");
  if (count) count.textContent = "(" + data.length + ")";
  renderUsers();
}

function renderUsers() {
  const list = $("user-list");
  if (!list) return;
  const open = list.querySelector(".user-card.open")?.dataset.id;
  list.innerHTML = "";

  const q = ($("acc-search")?.value || "").trim().toLowerCase();
  const sort = $("acc-sort")?.value || "new";
  const time = (iso) => (iso ? new Date(iso).getTime() : 0);
  const energyOf = (u) => (u.unlimited ? Infinity : u.energy ?? 0);

  const shown = allUsers
    .filter((u) => !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
    .filter((u) => accFilter === "all" || (accFilter === "active") === !!isActiveUser(u))
    .sort((a, b) =>
      sort === "seen"   ? time(b.last_sign_in_at) - time(a.last_sign_in_at) :
      sort === "energy" ? energyOf(b) - energyOf(a) :
      sort === "score"  ? (b.avg_score ?? -1) - (a.avg_score ?? -1) :
      sort === "name"   ? (a.name || a.email || "").localeCompare(b.name || b.email || "") :
                          time(b.created_at) - time(a.created_at));

  $("acc-shown").textContent = t("accShown").replace("{n}", shown.length).replace("{total}", allUsers.length);
  $("acc-none").hidden = shown.length > 0;

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleDateString(lang, { day: "numeric", month: "short" }) : null;

  for (const user of shown) {
    const row = buildUserCard(user, fmt);
    if (user.id === open) toggleUserCard(row, true);
    list.appendChild(row);
  }
}

function toggleUserCard(row, force) {
  const openNow = force ?? !row.classList.contains("open");
  if (openNow) document.querySelectorAll("#user-list .user-card.open").forEach((r) => r !== row && toggleUserCard(r, false));
  row.classList.toggle("open", openNow);
  row.querySelector(".uc-more").hidden = !openNow;
  row.querySelector(".uc-head").setAttribute("aria-expanded", String(openNow));
}

on("acc-search", "input", () => renderUsers());
on("acc-sort", "change", () => renderUsers());
document.querySelectorAll(".acc-filter .chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    accFilter = chip.dataset.filter;
    document.querySelectorAll(".acc-filter .chip").forEach((c) => c.classList.toggle("on", c === chip));
    renderUsers();
  })
);

function buildUserCard(user, fmt) {
    // Active means they have signed in within the last two weeks.
    const lastSeen = user.last_sign_in_at ? new Date(user.last_sign_in_at) : null;
    const active = lastSeen && Date.now() - lastSeen.getTime() < 14 * 864e5;

    const name = user.name || (user.email || "").split("@")[0];
    const row = document.createElement("article");
    row.className = "card user-card" + (active ? " is-active" : "");
    row.innerHTML =
      '<button type="button" class="uc-head" aria-expanded="false">' +
        '<span class="uc-avatar"></span>' +
        '<span class="uc-id"><h3></h3><span class="uc-email"></span></span>' +
        '<span class="uc-mini">' +
          '<img class="uc-mini-rank" alt="" hidden>' +
          '<span class="uc-mini-energy"><img src="energy.png" alt=""><b></b></span>' +
          '<span class="uc-mini-score"></span>' +
        "</span>" +
        '<span class="uc-chev" aria-hidden="true">›</span>' +
      "</button>" +
      '<div class="uc-more" hidden>' +
      '<div class="uc-tiles">' +
        '<div class="uc-tile"><span class="uc-num n-convos"></span><span class="uc-lab l-convos"></span></div>' +
        '<div class="uc-tile"><span class="uc-num n-reh"></span><span class="uc-lab l-reh"></span></div>' +
        '<div class="uc-tile uc-score"><span class="uc-num n-avg"></span><span class="uc-lab l-avg"></span></div>' +
      "</div>" +
      '<div class="uc-energy">' +
        '<span class="energy-chip"><img src="energy.png" alt=""><b class="e-num"></b></span>' +
        '<input type="number" class="e-amount" min="1" max="100000" value="5">' +
        '<button class="mini e-give"></button>' +
        '<button class="mini e-take"></button>' +
        '<button class="mini e-set"></button>' +
        '<button class="mini e-inf" hidden></button>' +
      "</div>" +
      '<div class="uc-foot">' +
        '<p class="uc-dates"></p>' +
        '<span class="uc-actions">' +
          '<button class="mini act-stats"></button>' +
          '<button class="mini danger act-del"></button>' +
        "</span>" +
      "</div>" +
      "</div>";

    row.querySelector(".uc-avatar").textContent = (name[0] || "?").toUpperCase();
    row.querySelector("h3").textContent = name;
    row.querySelector(".uc-email").textContent = user.email || "";
    const miniScore = row.querySelector(".uc-mini-score");
    miniScore.textContent = user.avg_score ?? "—";
    if (user.avg_score != null) paintScore(miniScore, miniScore, user.avg_score);

    row.querySelector(".n-convos").textContent = user.scenarios;
    row.querySelector(".n-reh").textContent = user.rehearsals;
    row.querySelector(".n-avg").textContent = user.avg_score ?? "—";
    paintScore(row.querySelector(".uc-score"), row.querySelector(".n-avg"), user.avg_score);
    row.querySelector(".l-convos").textContent = t("tileConvos");
    row.querySelector(".l-reh").textContent = t("tileRehearsals");
    row.querySelector(".l-avg").textContent = t("tileAvg");

    const seen = lastSeen ? t("lastSeen") + " " + fmt(user.last_sign_in_at) : t("neverIn");
    const dates = row.querySelector(".uc-dates");
    const state = document.createElement("span");
    state.className = active ? "uc-state on" : "uc-state";
    state.textContent = active ? "● " + t("activeNow") : t("dormant");
    dates.append(state, " · ");
    dates.append(t("joined") + " " + fmt(user.created_at) + " · " + seen);

    // energy for this one person: Give, Take, or Set an exact number.
    // On the admin's own card there is also the ∞ switch.
    const isMe = session && user.id === session.user.id;
    let unlimited = !!user.unlimited;
    const num = row.querySelector(".e-num");
    const miniNum = row.querySelector(".uc-mini-energy b");
    const miniRank = row.querySelector(".uc-mini-rank");
    const showNum = (balance) => (num.textContent = miniNum.textContent = unlimited ? "∞" : balance);
    let balance = user.energy ?? 0;
    showNum(balance);
    const rankChip = document.createElement("span");
    rankChip.className = "rank-chip";
    rankChip.innerHTML = "<img alt=''><span></span>";
    row.querySelector(".uc-energy").prepend(rankChip);
    const paintCardRank = () => {
      const r = rankFor(balance, unlimited);
      showRank(rankChip, r);
      miniRank.hidden = !r;
      if (r) { miniRank.src = "rank-" + r.family + ".png"; miniRank.title = r.name; }
    };
    paintCardRank();
    row.querySelector(".e-amount").placeholder = t("amountPh");

    const afterChange = (newBalance) => {
      balance = newBalance;
      showNum(balance);
      paintCardRank();
      if (isMe) refreshEnergy();
      toast(t("energyUpdated"));
    };

    const amountNow = () => Math.abs(parseInt(row.querySelector(".e-amount").value, 10) || 0);

    const changeOne = async (sign) => {
      const amount = amountNow();
      if (!amount) return;
      const { data, error } = await supabase.rpc("admin_change_energy", { target: user.id, delta: sign * amount });
      if (error) { toast(error.message); console.error(error); return; }
      afterChange(data);
    };

    const setOne = async () => {
      const raw = row.querySelector(".e-amount").value;
      if (raw === "") return;
      const { data, error } = await supabase.rpc("admin_set_energy", { target: user.id, amount: amountNow() });
      if (error) { toast(error.message); console.error(error); return; }
      afterChange(data);
    };

    const give = row.querySelector(".e-give");
    const take = row.querySelector(".e-take");
    const set = row.querySelector(".e-set");
    give.textContent = t("give");
    take.textContent = t("take");
    set.textContent = t("setTo");
    give.addEventListener("click", () => changeOne(+1));
    take.addEventListener("click", () => changeOne(-1));
    set.addEventListener("click", setOne);

    if (isMe) {
      const inf = row.querySelector(".e-inf");
      const paintInf = () => {
        inf.textContent = unlimited ? t("unlimitedOff") : t("unlimitedOn");
        inf.classList.toggle("on", unlimited);
      };
      paintInf();
      inf.hidden = false;
      inf.addEventListener("click", async () => {
        const { error } = await supabase.rpc("admin_set_unlimited", { turn_on: !unlimited });
        if (error) { toast(error.message); console.error(error); return; }
        unlimited = !unlimited;
        paintInf();
        showNum(balance);
        paintCardRank();
        refreshEnergy();
        toast(t("energyUpdated"));
      });
    }

    const statsBtn = row.querySelector(".act-stats");
    statsBtn.textContent = t("viewStats");
    statsBtn.addEventListener("click", () => openUserStats(user));

    const del = row.querySelector(".act-del");
    del.textContent = t("armDelete");
    del.addEventListener("click", () => armDelete(del, user));

    row.dataset.id = user.id;
    row.querySelector(".uc-head").addEventListener("click", () => toggleUserCard(row));
    return row;
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
  on(id, "input", () => applyTheme(readAdminPickers()));
}

on("btn-admin-colours", "click", async () => {
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
on("btn-admin-original", "click", () => {
  fillAdminPickers(ORIGINAL_THEME);
  applyTheme(ORIGINAL_THEME);
});

on("btn-admin-save", "click", async () => {
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
