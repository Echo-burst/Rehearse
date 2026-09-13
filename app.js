import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD } from "./config.js";
import { LANGUAGES, STRINGS } from "./i18n.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- app state -------------------------------------------------------------
let scenario = null;      // the conversation being rehearsed right now
let messages = [];        // [{ role: "user" | "assistant", content }]
let lang = "en";          // current interface language

// ---- tiny helpers ----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const t = (key) => STRINGS[lang][key] ?? STRINGS.en[key] ?? key;

function show(name) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  const view = $("view-" + name);
  view.hidden = false;

  // Restart the entrance animation. Removing the class, forcing the browser to
  // recalculate layout, then re-adding it is what makes it replay every time.
  view.classList.remove("enter");
  void view.offsetWidth;
  view.classList.add("enter");

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
  if ($("greet").textContent) updateGreeting();
}

function initLanguage() {
  const select = $("lang");
  for (const [code, name] of Object.entries(LANGUAGES)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = name;
    select.appendChild(option);
  }

  // Remembered choice first, otherwise the phone's own language, otherwise English.
  const saved = localStorage.getItem("lang");
  const browser = (navigator.language || "en").slice(0, 2);
  setLanguage(saved || (STRINGS[browser] ? browser : "en"));
  select.value = lang;

  select.addEventListener("change", () => setLanguage(select.value));
}

initLanguage();

// ============================================================================
// 1. AUTHENTICATION  (Supabase Auth)
// ============================================================================

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btn-signin");
  showError($("auth-error"), "");
  busy(btn, true, t("signingIn"));

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
    showError($("auth-error"), t("errShortPw"));
    return;
  }

  busy(btn, true, t("creating"));
  const { error } = await supabase.auth.signUp({ email, password });
  busy(btn, false);

  if (error) showError($("auth-error"), error.message);
  else toast(t("accountCreated"));
});

$("btn-demo").addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (error) showError($("auth-error"), error.message);
});

$("btn-signout").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Runs on page load and on every sign in / sign out.
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    show("list");
    updateGreeting();
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
      '<button class="scenario-open"><h3></h3><p></p></button>' +
      '<div class="scenario-actions">' +
      '<button class="mini act-pin"></button>' +
      '<button class="mini danger act-del"></button>' +
      "</div>";

    card.querySelector("h3").textContent = row.title;
    card.querySelector("p").textContent = t("with") + " " + row.counterpart;
    card.querySelector(".act-pin").textContent = row.pinned ? t("unpin") : t("pin");
    card.querySelector(".act-del").textContent = t("del");

    card.querySelector(".scenario-open").addEventListener("click", () => startRehearsal(row));
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
    context: $("s-context").value.trim(),
    goal: $("s-goal").value.trim(),
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

    item.querySelector(".history-score").textContent = row.score ?? "—";
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
  $("rehearse-title").textContent = row.title + " · " + row.counterpart;
  show("rehearse");
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
    $("feedback-body").textContent = result.feedback;
    await saveRehearsal(result.score, result.feedback);
    show("feedback");
  } catch (err) {
    toast(t("errFeedback"));
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
    if (el.dataset.goto === "list") {
      updateGreeting();
      loadScenarios();
    }
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
// screen. The banner below replaces the browser's own install chrome, which is
// easy to miss and does not exist at all on iPhone.
// ============================================================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker did not register:", err);
    });
  });
}

let installEvent = null;

const alreadyInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

function showInstallBanner(iosMode) {
  if (alreadyInstalled()) return;
  if (localStorage.getItem("installDismissed")) return;

  $("install-hint").hidden = !iosMode;
  $("install-go").hidden = iosMode;
  if (iosMode) $("install-hint").textContent = t("installIos");

  $("install").hidden = false;
}

// Chrome and Edge fire this instead of showing their own prompt once we
// call preventDefault. We hold the event and fire it when the user taps Install.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  showInstallBanner(false);
});

// Safari on iPhone never fires that event, so the only option is instructions.
if (isIos()) {
  window.addEventListener("load", () => setTimeout(() => showInstallBanner(true), 1200));
}

$("install-go").addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $("install").hidden = true;
});

$("install-later").addEventListener("click", () => {
  localStorage.setItem("installDismissed", "1");
  $("install").hidden = true;
});

window.addEventListener("appinstalled", () => {
  $("install").hidden = true;
});
