// Sea Turtle Survey — single-page PWA
// One snorkel survey = shared metadata + N turtle observations.
// Persists drafts to localStorage; syncs completed surveys to a Google Apps
// Script web app that writes one row per turtle to a single Sheet tab.

/* =========================================================================
 *  REFERENCE DATA
 * ========================================================================= */

const DURATION_HOURS = [0, 1, 2, 3, 4, 5];
const DURATION_MINUTES = Array.from({ length: 60 }, (_, i) => i);

const SPECIES_OPTIONS = ["Green", "Hawksbill", "Other"];
const BEHAVIOUR_OPTIONS = [
  { code: "F", label: "Feeding" },
  { code: "R", label: "Resting" },
  { code: "S", label: "Swimming" },
];
const SEX_OPTIONS = [
  { code: "M", label: "Male" },
  { code: "F", label: "Female" },
  { code: "JV", label: "Juvenile" },
  { code: "U", label: "Unidentified" },
];

// Seeded dive sites — reused from BTC EMP Uploader.
const DEFAULT_DIVE_SITES = [
  "Twins",
  "Mango Bay",
  "Junkyard",
  "Aow Leuk",
  "Tanote Bay",
  "BTD Reef",
  "Tao Tong",
  "Freedom Beach",
  "Laem Thian",
  "Japanese Gardens",
];

/* =========================================================================
 *  STORAGE KEYS
 * ========================================================================= */

const LS_DRAFT = "sts:draft";
const LS_QUEUE = "sts:queue";
const LS_SETTINGS = "sts:settings";
const LS_CUSTOM_SITES = "sts:customDiveSites";

// Baked-in Apps Script Web App endpoint for the BTC team's shared master
// Sheet. New devices pick this up automatically — teammates only need to
// open the URL and start submitting. To override on a specific device, set
// a different URL in Settings (⚙). Clearing the field disables sync.
const DEFAULT_SYNC_URL = "https://script.google.com/macros/s/AKfycbxfjAlZLgYGgg1dqOuD7SlUBEiF53_m1D1pB2avrbcRABVyo5TefIOA5zSlXx5JIDRpsg/exec";

// Shared secret token sent in every submission payload. The Apps Script
// checks this value at the top of doPost and rejects requests without a
// match. Stops drive-by scrapers. Not strong security — visible to anyone
// who reads app.js — but a good speed-bump.
//
// To rotate: generate a new token, update this constant AND the SYNC_SECRET
// constant in apps-script.gs, redeploy the Apps Script, bump CACHE_VERSION.
const SYNC_SECRET = "7e484928-56fd-47d5-9729-1de2b184b061-b3febe8b";

/* =========================================================================
 *  STATE
 * ========================================================================= */

const state = {
  draft: null,
  queue: [],
  settings: { syncUrl: "", autoSync: true },
  current: "setup",
  expandedTurtle: null, // id of the turtle card currently expanded
};

function newDraft() {
  return {
    id: cryptoId(),
    createdAt: new Date().toISOString(),
    metadata: {
      surveyLeader: "",
      uploadedBy: "",
      numberOfSurveyors: "",
      date: "",
      site: "",
      surveyDuration: "",
    },
    turtles: [],
    submitted: false,
  };
}

function newTurtle() {
  return {
    id: cryptoId(),
    timeSeen: "",
    depthObserved: "",
    species: "",
    speciesOther: "",
    behaviour: "",
    size: "",
    sex: "",
    turtleName: "",
    markings: "",
  };
}

function cryptoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* =========================================================================
 *  PERSISTENCE
 * ========================================================================= */

function saveDraft() {
  if (state.draft) localStorage.setItem(LS_DRAFT, JSON.stringify(state.draft));
}
function loadDraft() {
  const raw = localStorage.getItem(LS_DRAFT);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d.turtles) d.turtles = [];
    if (!d.metadata) d.metadata = {};
    if (typeof d.submitted !== "boolean") d.submitted = false;
    return d;
  } catch { return null; }
}
function clearDraft() {
  localStorage.removeItem(LS_DRAFT);
  state.draft = null;
}
function saveQueue() { localStorage.setItem(LS_QUEUE, JSON.stringify(state.queue)); }
function loadQueue() {
  const raw = localStorage.getItem(LS_QUEUE);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
function loadCustomSites() {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_SITES) || "[]"); }
  catch { return []; }
}
function saveCustomSites(list) {
  localStorage.setItem(LS_CUSTOM_SITES, JSON.stringify(list));
}
function getAllDiveSites() {
  const seen = new Set();
  const out = [];
  [...DEFAULT_DIVE_SITES, ...loadCustomSites()].forEach((s) => {
    const trimmed = (s || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
function addCustomSite(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  const all = getAllDiveSites().map((s) => s.toLowerCase());
  if (all.includes(trimmed.toLowerCase())) return false;
  const custom = loadCustomSites();
  custom.push(trimmed);
  saveCustomSites(custom);
  return true;
}

function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }
function loadSettings() {
  // Default to the baked-in team endpoint so new devices work without any
  // manual setup. Existing saved settings override (user values win, even if
  // they explicitly cleared the URL to disable sync).
  const defaults = { syncUrl: DEFAULT_SYNC_URL, autoSync: true };
  const raw = localStorage.getItem(LS_SETTINGS);
  if (!raw) return defaults;
  try { return { ...defaults, ...JSON.parse(raw) }; }
  catch { return defaults; }
}

/* =========================================================================
 *  ROUTING / RENDER
 * ========================================================================= */

const $app = () => document.getElementById("app");

function renderTpl(id) {
  const tpl = document.getElementById(id);
  const node = tpl.content.firstElementChild.cloneNode(true);
  $app().innerHTML = "";
  $app().appendChild(node);
  return node;
}

function go(screen) {
  state.current = screen;
  document.querySelectorAll("#survey-tabs .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === screen);
  });
  const tabs = document.getElementById("survey-tabs");
  tabs.classList.toggle("hidden", screen === "setup");
  if (screen === "setup") renderSetup();
  else if (screen === "info") renderInfo();
  else if (screen === "turtles") renderTurtles();
  else if (screen === "review") renderReview();
}

/* =========================================================================
 *  DIVE SITE PICKER (same UX as EMP Uploader)
 * ========================================================================= */

function attachDiveSitePicker(input) {
  const wrap = document.createElement("div");
  wrap.className = "dive-site-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const datalistId = "dive-sites-" + Math.random().toString(36).slice(2, 8);
  const datalist = document.createElement("datalist");
  datalist.id = datalistId;
  input.setAttribute("list", datalistId);
  wrap.appendChild(datalist);

  function refreshDatalist() {
    datalist.innerHTML = "";
    getAllDiveSites().forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      datalist.appendChild(opt);
    });
  }
  refreshDatalist();

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dive-site-toggle";
  toggle.textContent = "+";
  toggle.title = "Pick from list";
  wrap.appendChild(toggle);

  const panel = document.createElement("div");
  panel.className = "dive-site-panel hidden";
  wrap.appendChild(panel);

  function setValue(val) {
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderPanel() {
    panel.innerHTML = "";
    getAllDiveSites().forEach((s) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dive-site-item";
      item.textContent = s;
      item.addEventListener("click", () => { setValue(s); closePanel(); });
      panel.appendChild(item);
    });

    const addRow = document.createElement("div");
    addRow.className = "dive-site-add-row";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "dive-site-add";
    addBtn.textContent = "+ Add new site";

    const addForm = document.createElement("div");
    addForm.className = "dive-site-add-form hidden";
    const newInput = document.createElement("input");
    newInput.type = "text";
    newInput.maxLength = 40;
    newInput.placeholder = "New dive site name";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ghost";
    cancelBtn.textContent = "Cancel";
    addForm.append(newInput, saveBtn, cancelBtn);

    addBtn.addEventListener("click", () => {
      addBtn.classList.add("hidden");
      addForm.classList.remove("hidden");
      newInput.focus();
    });
    cancelBtn.addEventListener("click", () => {
      addForm.classList.add("hidden");
      addBtn.classList.remove("hidden");
      newInput.value = "";
    });
    function commitNew() {
      const name = newInput.value.trim();
      if (!name) return;
      const added = addCustomSite(name);
      refreshDatalist();
      setValue(name);
      if (added) toast(`Added "${name}" to dive sites.`);
      renderPanel();
      closePanel();
    }
    saveBtn.addEventListener("click", commitNew);
    newInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitNew(); }
      if (e.key === "Escape") { cancelBtn.click(); }
    });

    addRow.append(addBtn, addForm);
    panel.appendChild(addRow);
  }
  renderPanel();

  function openPanel() { panel.classList.remove("hidden"); }
  function closePanel() { panel.classList.add("hidden"); }
  function togglePanel() { panel.classList.toggle("hidden"); }

  toggle.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });

  const outsideHandler = (e) => { if (!wrap.contains(e.target)) closePanel(); };
  document.addEventListener("click", outsideHandler);
}

/* =========================================================================
 *  DURATION DROPDOWNS (Hours + Minutes)
 *  Canonical storage is the "HH:MM" string. The two selects are pure UI.
 * ========================================================================= */

function attachDurationPicker(scope, onChange) {
  const hSel = scope.querySelector('[name="durationHours"]');
  const mSel = scope.querySelector('[name="durationMinutes"]');
  if (!hSel || !mSel) return null;

  DURATION_HOURS.forEach((h) => {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = `${String(h).padStart(2, "0")} h`;
    hSel.appendChild(o);
  });
  DURATION_MINUTES.forEach((m) => {
    const o = document.createElement("option");
    o.value = String(m);
    o.textContent = `${String(m).padStart(2, "0")} min`;
    mSel.appendChild(o);
  });

  function setValueFromStored(stored) {
    if (!stored || !/^\d{1,2}:[0-5]\d$/.test(stored)) {
      hSel.value = "";
      mSel.value = "";
      return;
    }
    const [h, m] = stored.split(":").map((p) => parseInt(p, 10));
    hSel.value = DURATION_HOURS.includes(h) ? String(h) : "";
    mSel.value = DURATION_MINUTES.includes(m) ? String(m) : "";
  }

  function readValue() {
    if (hSel.value === "" || mSel.value === "") return "";
    const h = parseInt(hSel.value, 10);
    const m = parseInt(mSel.value, 10);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  if (typeof onChange === "function") {
    hSel.addEventListener("change", onChange);
    mSel.addEventListener("change", onChange);
  }

  return { setValueFromStored, readValue, hSel, mSel };
}

/* =========================================================================
 *  SETUP SCREEN
 * ========================================================================= */

function renderSetup() {
  const node = renderTpl("tpl-setup");
  const form = node.querySelector("#setup-form");
  const resumeBtn = node.querySelector("#resume-btn");

  const existing = loadDraft();
  if (existing) {
    resumeBtn.classList.remove("hidden");
    const m = existing.metadata || {};
    if (m.surveyLeader) form.querySelector('[name="surveyLeader"]').value = m.surveyLeader;
    if (m.uploadedBy) form.querySelector('[name="uploadedBy"]').value = m.uploadedBy;
    if (m.numberOfSurveyors) form.querySelector('[name="numberOfSurveyors"]').value = m.numberOfSurveyors;
    if (m.date) form.querySelector('[name="date"]').value = m.date;
    if (m.site) form.querySelector('[name="site"]').value = m.site;
    resumeBtn.addEventListener("click", () => {
      state.draft = existing;
      saveDraft();
      go("turtles");
    });
  }

  if (!form.date.value) form.date.value = new Date().toISOString().slice(0, 10);

  attachDiveSitePicker(form.querySelector('[name="site"]'));

  const duration = attachDurationPicker(form);
  if (duration && existing) duration.setValueFromStored(existing.metadata?.surveyDuration || "");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const meta = {
      surveyLeader: (fd.get("surveyLeader") || "").toString().trim(),
      uploadedBy: (fd.get("uploadedBy") || "").toString().trim(),
      numberOfSurveyors: (fd.get("numberOfSurveyors") || "").toString().trim(),
      date: (fd.get("date") || "").toString(),
      site: (fd.get("site") || "").toString().trim(),
      surveyDuration: duration ? duration.readValue() : "",
    };
    if (!meta.surveyLeader || !meta.uploadedBy || !meta.numberOfSurveyors || !meta.date || !meta.site || !meta.surveyDuration) {
      toast("Fill all metadata fields, including hours and minutes.");
      return;
    }
    if (!state.draft) state.draft = newDraft();
    state.draft.metadata = meta;
    saveDraft();
    go("turtles");
  });
}

/* =========================================================================
 *  INFO SCREEN (auto-saving metadata editor)
 * ========================================================================= */

function renderInfo() {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-info");
  const form = node.querySelector("#info-form");
  const savedIndicator = node.querySelector("#info-saved");

  const m = state.draft.metadata;
  form.querySelector('[name="surveyLeader"]').value = m.surveyLeader || "";
  form.querySelector('[name="uploadedBy"]').value = m.uploadedBy || "";
  form.querySelector('[name="numberOfSurveyors"]').value = m.numberOfSurveyors || "";
  form.querySelector('[name="date"]').value = m.date || "";
  form.querySelector('[name="site"]').value = m.site || "";

  attachDiveSitePicker(form.querySelector('[name="site"]'));

  let savedTimer = null;
  function flashSaved() {
    if (!savedIndicator) return;
    savedIndicator.textContent = "Saved ✓";
    savedIndicator.classList.add("flash");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      savedIndicator.textContent = "Changes save automatically.";
      savedIndicator.classList.remove("flash");
    }, 1400);
  }

  function persist() {
    const fd = new FormData(form);
    state.draft.metadata.surveyLeader = (fd.get("surveyLeader") || "").toString().trim();
    state.draft.metadata.uploadedBy = (fd.get("uploadedBy") || "").toString().trim();
    state.draft.metadata.numberOfSurveyors = (fd.get("numberOfSurveyors") || "").toString().trim();
    state.draft.metadata.date = (fd.get("date") || "").toString();
    state.draft.metadata.site = (fd.get("site") || "").toString().trim();
    state.draft.metadata.surveyDuration = duration ? duration.readValue() : "";
    saveDraft();
    flashSaved();
  }

  const duration = attachDurationPicker(form, persist);
  if (duration) duration.setValueFromStored(m.surveyDuration || "");

  ["surveyLeader", "uploadedBy", "numberOfSurveyors", "site"].forEach((n) => {
    const el = form.querySelector(`[name="${n}"]`);
    if (el) el.addEventListener("input", persist);
  });
  form.querySelector('[name="date"]').addEventListener("change", persist);
}

/* =========================================================================
 *  TURTLES SCREEN — collapsible list of per-turtle cards
 * ========================================================================= */

function renderTurtles() {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-turtles");

  const countPill = node.querySelector("#turtle-count");
  const list = node.querySelector("#turtle-list");
  const addBtn = node.querySelector("#add-turtle");

  function refreshCount() {
    const n = state.draft.turtles.length;
    countPill.textContent = `${n} turtle${n === 1 ? "" : "s"}`;
  }
  refreshCount();

  function renderList() {
    list.innerHTML = "";
    if (state.draft.turtles.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "No turtles logged. Tap “+ Add a turtle” if you spotted any — or head to Review and submit a zero-turtle survey (absence is data).";
      list.appendChild(hint);
      return;
    }
    state.draft.turtles.forEach((t, idx) => {
      list.appendChild(buildTurtleCard(t, idx, () => {
        refreshCount();
        renderList();
      }));
    });
  }
  renderList();

  addBtn.addEventListener("click", () => {
    const t = newTurtle();
    state.draft.turtles.push(t);
    state.expandedTurtle = t.id;
    saveDraft();
    refreshCount();
    renderList();
  });
}

function buildTurtleCard(turtle, idx, onChange) {
  const card = document.createElement("div");
  card.className = "turtle-card" + (state.expandedTurtle === turtle.id ? " open" : "");

  const head = document.createElement("div");
  head.className = "turtle-card-head";

  const num = document.createElement("div");
  num.className = "turtle-card-num";
  num.textContent = idx + 1;
  head.appendChild(num);

  const summary = document.createElement("div");
  summary.className = "turtle-card-summary";
  const title = document.createElement("div");
  title.className = "turtle-card-title";
  title.textContent = turtle.turtleName ? `Turtle ${idx + 1} — ${turtle.turtleName}` : `Turtle ${idx + 1}`;
  const meta = document.createElement("div");
  meta.className = "turtle-card-meta";
  meta.textContent = buildTurtleSummary(turtle);
  const incompleteBadge = document.createElement("span");
  incompleteBadge.className = "incomplete-badge";
  incompleteBadge.textContent = "Incomplete";
  summary.append(title, meta, incompleteBadge);
  head.appendChild(summary);

  function refreshIncomplete() {
    const missing = turtleMissingFields(turtle);
    incompleteBadge.classList.toggle("hidden", missing.length === 0);
    incompleteBadge.title = missing.length ? `Missing: ${missing.join(", ")}` : "";
  }
  refreshIncomplete();

  const chev = document.createElement("div");
  chev.className = "turtle-card-chev";
  chev.textContent = state.expandedTurtle === turtle.id ? "▾" : "▸";
  head.appendChild(chev);

  head.addEventListener("click", () => {
    state.expandedTurtle = state.expandedTurtle === turtle.id ? null : turtle.id;
    onChange();
  });
  card.appendChild(head);

  if (state.expandedTurtle === turtle.id) {
    card.appendChild(buildTurtleBody(turtle, () => {
      // Refresh just the summary line + title without re-rendering the world.
      title.textContent = turtle.turtleName ? `Turtle ${idx + 1} — ${turtle.turtleName}` : `Turtle ${idx + 1}`;
      meta.textContent = buildTurtleSummary(turtle);
      refreshIncomplete();
    }, () => {
      // Delete this turtle.
      const i = state.draft.turtles.findIndex((x) => x.id === turtle.id);
      if (i >= 0) state.draft.turtles.splice(i, 1);
      if (state.expandedTurtle === turtle.id) state.expandedTurtle = null;
      saveDraft();
      onChange();
    }, () => {
      // Save & collapse — data is already persisted on each input change.
      state.expandedTurtle = null;
      onChange();
    }));
  }

  return card;
}

function buildTurtleSummary(t) {
  const behaviourLabel = (BEHAVIOUR_OPTIONS.find((o) => o.code === t.behaviour) || {}).label;
  const sexLabel = (SEX_OPTIONS.find((o) => o.code === t.sex) || {}).label;
  const bits = [];
  if (t.species) bits.push(t.species === "Other" && t.speciesOther ? `Other: ${t.speciesOther}` : t.species);
  if (behaviourLabel) bits.push(behaviourLabel);
  if (sexLabel) bits.push(sexLabel);
  if (t.size) bits.push(`${t.size} cm`);
  if (t.timeSeen) bits.push(t.timeSeen);
  return bits.length ? bits.join(" · ") : "Tap to fill in details";
}

function buildTurtleBody(turtle, onUpdate, onDelete, onSave) {
  const body = document.createElement("div");
  body.className = "turtle-card-body";

  // Grid of paired inputs (most fields)
  const grid = document.createElement("div");
  grid.className = "turtle-grid";

  function field(labelText, build) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = labelText;
    label.appendChild(span);
    label.appendChild(build());
    return label;
  }

  function persist() {
    saveDraft();
    onUpdate();
  }

  // Time Seen
  grid.appendChild(field("Time Seen *", () => {
    const inp = document.createElement("input");
    inp.type = "time";
    inp.value = turtle.timeSeen || "";
    inp.addEventListener("change", () => { turtle.timeSeen = inp.value; persist(); });
    return inp;
  }));

  // Depth Observed
  grid.appendChild(field("Depth Observed (m) *", () => {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = "0.1";
    inp.min = "0";
    inp.inputMode = "decimal";
    inp.placeholder = "e.g. 5.5";
    inp.value = turtle.depthObserved || "";
    inp.addEventListener("focus", () => setTimeout(() => inp.select(), 0));
    inp.addEventListener("input", () => { turtle.depthObserved = inp.value; persist(); });
    inp.addEventListener("blur", () => {
      const raw = inp.value.trim();
      if (!raw) return;
      const n = parseFloat(raw);
      if (isNaN(n)) return;
      const formatted = Math.max(0, n).toFixed(1);
      inp.value = formatted;
      turtle.depthObserved = formatted;
      persist();
    });
    return inp;
  }));

  // Size
  grid.appendChild(field("Size (cm) *", () => {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "0";
    inp.step = "1";
    inp.inputMode = "numeric";
    inp.placeholder = "Carapace length, cm";
    inp.value = turtle.size || "";
    inp.addEventListener("focus", () => setTimeout(() => inp.select(), 0));
    inp.addEventListener("input", () => { turtle.size = inp.value; persist(); });
    return inp;
  }));

  // Turtle Name
  grid.appendChild(field("Turtle Name (if known)", () => {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.maxLength = 60;
    inp.placeholder = "e.g. Bumpy";
    inp.value = turtle.turtleName || "";
    inp.addEventListener("input", () => { turtle.turtleName = inp.value; persist(); });
    return inp;
  }));

  body.appendChild(grid);

  // Species (pill row + Other text)
  body.appendChild(buildPillField("Species *", SPECIES_OPTIONS.map((s) => ({ code: s, label: s })),
    turtle.species,
    (val) => { turtle.species = val; persist(); rerenderOther(); }));

  const otherWrap = document.createElement("label");
  otherWrap.style.marginTop = "-4px";
  const otherSpan = document.createElement("span");
  otherSpan.textContent = "Other species — please specify";
  const otherInp = document.createElement("input");
  otherInp.type = "text";
  otherInp.maxLength = 60;
  otherInp.placeholder = "e.g. Loggerhead";
  otherInp.value = turtle.speciesOther || "";
  otherInp.addEventListener("input", () => { turtle.speciesOther = otherInp.value; persist(); });
  otherWrap.append(otherSpan, otherInp);
  body.appendChild(otherWrap);
  function rerenderOther() {
    otherWrap.classList.toggle("hidden", turtle.species !== "Other");
  }
  rerenderOther();

  // Behaviour
  body.appendChild(buildPillField("Behaviour *", BEHAVIOUR_OPTIONS,
    turtle.behaviour,
    (val) => { turtle.behaviour = val; persist(); }));

  // Sex
  body.appendChild(buildPillField("Sex *", SEX_OPTIONS,
    turtle.sex,
    (val) => { turtle.sex = val; persist(); }));

  // Markings (free text, larger box)
  const markingsLabel = document.createElement("label");
  const markingsSpan = document.createElement("span");
  markingsSpan.textContent = "Markings / distinguishing features";
  const markingsArea = document.createElement("textarea");
  markingsArea.rows = 3;
  markingsArea.maxLength = 800;
  markingsArea.placeholder = "Notches, scars, barnacles, tag IDs, colouration, …";
  markingsArea.value = turtle.markings || "";
  markingsArea.addEventListener("input", () => { turtle.markings = markingsArea.value; persist(); });
  markingsLabel.append(markingsSpan, markingsArea);
  body.appendChild(markingsLabel);

  // Card actions — Delete (left, destructive) + Save Turtle (right, primary)
  const actions = document.createElement("div");
  actions.className = "turtle-card-actions";
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "turtle-delete-btn";
  delBtn.textContent = "Delete this turtle";
  delBtn.addEventListener("click", () => {
    if (!confirm("Delete this turtle? This removes it from the draft on this device.")) return;
    onDelete();
    toast("Turtle removed.");
  });
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary turtle-save-btn";
  saveBtn.textContent = "Save Turtle";
  saveBtn.addEventListener("click", () => {
    if (typeof onSave === "function") onSave();
    toast("Turtle saved.");
  });
  actions.append(delBtn, saveBtn);
  body.appendChild(actions);

  return body;
}

function buildPillField(labelText, options, currentValue, onChange) {
  const wrap = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = labelText;
  wrap.appendChild(span);

  const group = document.createElement("div");
  group.className = "pill-group";
  options.forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pill-btn" + (currentValue === opt.code ? " selected" : "");
    b.textContent = opt.code === opt.label ? opt.code : `${opt.code} — ${opt.label}`;
    b.addEventListener("click", () => {
      const next = currentValue === opt.code ? "" : opt.code;
      currentValue = next;
      onChange(next);
      group.querySelectorAll(".pill-btn").forEach((x) => x.classList.remove("selected"));
      if (next) b.classList.add("selected");
    });
    group.appendChild(b);
  });
  wrap.appendChild(group);
  return wrap;
}

/* =========================================================================
 *  REVIEW / SUBMIT
 * ========================================================================= */

function renderReview() {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-review");
  const sum = node.querySelector("#review-summary");
  const meta = state.draft.metadata;

  const metaList = document.createElement("dl");
  metaList.className = "review-meta";
  [
    ["Survey Leader", meta.surveyLeader],
    ["Uploaded By", meta.uploadedBy],
    ["Number of Surveyors", meta.numberOfSurveyors],
    ["Date", meta.date],
    ["Site", meta.site],
    ["Survey Duration", meta.surveyDuration],
    ["Number of Turtles Seen", String(state.draft.turtles.length)],
  ].forEach(([k, v]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = (v === "" || v === undefined || v === null) ? "—" : v;
    metaList.append(dt, dd);
  });
  sum.appendChild(metaList);

  // Turtle block
  const block = document.createElement("div");
  block.className = "review-block";
  const h4 = document.createElement("h4");
  h4.textContent = "Turtles ";
  const badge = document.createElement("span");
  const status = reviewStatus();
  badge.className = "review-status " + status.kind;
  badge.textContent = status.label;
  h4.appendChild(badge);
  block.appendChild(h4);

  if (status.notes) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = status.notes;
    p.style.margin = "4px 0 0";
    block.appendChild(p);
  }

  if (state.draft.turtles.length > 0) {
    const mini = document.createElement("div");
    mini.className = "turtle-mini-list";
    state.draft.turtles.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "turtle-mini";
      const numEl = document.createElement("span");
      numEl.className = "turtle-mini-num";
      numEl.textContent = `#${i + 1}`;
      const detail = document.createElement("span");
      detail.textContent = buildTurtleSummary(t);
      const wrap = document.createElement("div");
      wrap.style.flex = "1";
      const wTitle = document.createElement("div");
      wTitle.textContent = t.turtleName ? t.turtleName : `Turtle ${i + 1}`;
      wTitle.style.fontWeight = "600";
      const wDetail = document.createElement("div");
      wDetail.className = "turtle-mini-detail";
      wDetail.textContent = buildTurtleSummary(t);
      wrap.append(wTitle, wDetail);
      const missing = turtleMissingFields(t);
      if (missing.length) {
        const warn = document.createElement("div");
        warn.className = "turtle-mini-warn";
        warn.textContent = `Missing: ${missing.join(", ")}`;
        wrap.appendChild(warn);
      }
      row.append(numEl, wrap);
      mini.appendChild(row);
    });
    block.appendChild(mini);
  }

  sum.appendChild(block);

  const submitBtn = node.querySelector("#submit-all");
  const noTurtles = state.draft.turtles.length === 0;
  const incompleteCount = state.draft.turtles.filter((t) => turtleMissingFields(t).length > 0).length;
  submitBtn.disabled = state.draft.submitted || incompleteCount > 0;
  if (state.draft.submitted) {
    submitBtn.textContent = "ALREADY SUBMITTED";
    submitBtn.title = "This draft has already been submitted. Reset to start a new survey.";
  } else if (incompleteCount > 0) {
    submitBtn.textContent = "SUBMIT SURVEY";
    submitBtn.title = `${incompleteCount} turtle${incompleteCount === 1 ? "" : "s"} still missing required fields. Fill them in before submitting.`;
  } else if (noTurtles) {
    submitBtn.textContent = "SUBMIT SURVEY (0 TURTLES SEEN)";
    submitBtn.title = "No turtles were seen on this survey. Submits one row with all metadata and \"-\" in every turtle field.";
  } else {
    submitBtn.textContent = "SUBMIT SURVEY";
    submitBtn.title = `Submit ${state.draft.turtles.length} turtle row${state.draft.turtles.length === 1 ? "" : "s"} to the Sheet.`;
  }
  submitBtn.addEventListener("click", submitSurvey);

  node.querySelector("#download-csv").addEventListener("click", downloadCSV);
  node.querySelector("#copy-tsv").addEventListener("click", copyTSV);
  node.querySelector("#export-json").addEventListener("click", exportJSON);
  node.querySelector("#discard-all").addEventListener("click", () => {
    if (confirm("Reset all data for this survey? This wipes the entire draft and cannot be undone.")) {
      clearDraft();
      toast("All data reset");
      go("setup");
    }
  });
}

function reviewStatus() {
  const n = state.draft.turtles.length;
  if (state.draft.submitted) {
    return { kind: "complete", label: "Submitted", notes: "This survey has been submitted. Reset to start a new one." };
  }
  if (n === 0) {
    return {
      kind: "complete",
      label: "Zero turtles",
      notes: "No turtles were seen — absence is data. Submitting writes one row with all the survey metadata and \"-\" in every turtle field.",
    };
  }
  const incomplete = state.draft.turtles.filter((t) => turtleMissingFields(t).length > 0).length;
  if (incomplete === 0) {
    return { kind: "complete", label: "Complete", notes: `${n} turtle${n === 1 ? "" : "s"} ready to submit.` };
  }
  return {
    kind: "partial",
    label: "Incomplete",
    notes: `${n} turtle${n === 1 ? "" : "s"} logged · ${incomplete} with missing required fields. Fill them in on the Turtles tab before submitting.`,
  };
}

function turtleMissingFields(t) {
  const missing = [];
  if (!t.timeSeen) missing.push("time");
  if (!t.depthObserved) missing.push("depth");
  if (!t.species) missing.push("species");
  if (t.species === "Other" && !t.speciesOther) missing.push("species name");
  if (!t.behaviour) missing.push("behaviour");
  if (!t.size) missing.push("size");
  if (!t.sex) missing.push("sex");
  return missing;
}

/* =========================================================================
 *  PAYLOAD / SCHEMA
 * ========================================================================= */

function buildSchema() {
  return {
    meta: [
      "surveyId",
      "submittedAt",
      "surveyLeader",
      "uploadedBy",
      "numberOfSurveyors",
      "date",
      "site",
      "surveyDuration",
      "numberOfTurtlesSeen",
    ],
    turtle: [
      "turtleNumber",
      "timeSeen",
      "depthObserved",
      "species",
      "speciesOther",
      "behaviour",
      "size",
      "sex",
      "turtleName",
      "markings",
    ],
  };
}

function buildRows(draft) {
  const submittedAt = new Date().toISOString();
  const numTurtles = draft.turtles.length;
  const baseMeta = {
    surveyId: draft.id,
    submittedAt,
    surveyLeader: draft.metadata.surveyLeader || "",
    uploadedBy: draft.metadata.uploadedBy || "",
    numberOfSurveyors: draft.metadata.numberOfSurveyors || "",
    date: draft.metadata.date || "",
    site: draft.metadata.site || "",
    surveyDuration: draft.metadata.surveyDuration || "",
  };

  // Zero-turtle survey: absence is data. Emit a single row with metadata
  // intact and every turtle-specific field set to "-" as an explicit "no
  // sighting" placeholder. numberOfTurtlesSeen reads 0 so the Sheet column
  // unambiguously records the null result.
  if (numTurtles === 0) {
    return [{
      ...baseMeta,
      numberOfTurtlesSeen: 0,
      turtleNumber: "-",
      timeSeen: "-",
      depthObserved: "-",
      species: "-",
      speciesOther: "-",
      behaviour: "-",
      size: "-",
      sex: "-",
      turtleName: "-",
      markings: "-",
    }];
  }

  return draft.turtles.map((t, i) => ({
    ...baseMeta,
    numberOfTurtlesSeen: numTurtles,
    turtleNumber: i + 1,
    timeSeen: t.timeSeen || "",
    depthObserved: t.depthObserved || "",
    species: t.species || "",
    speciesOther: t.speciesOther || "",
    behaviour: t.behaviour || "",
    size: t.size || "",
    sex: t.sex || "",
    turtleName: t.turtleName || "",
    markings: t.markings || "",
  }));
}

/* =========================================================================
 *  SUBMIT / SYNC
 * ========================================================================= */

async function submitSurvey() {
  if (!state.draft) return;
  if (state.draft.submitted) {
    toast("This survey has already been submitted.");
    return;
  }
  // Zero turtles is a valid submission ("absence is data") — buildRows
  // will emit a single placeholder row. Only block when there ARE turtles
  // logged but some are missing required fields.
  if (state.draft.turtles.length > 0) {
    const incomplete = state.draft.turtles
      .map((t, i) => ({ idx: i + 1, missing: turtleMissingFields(t) }))
      .filter((x) => x.missing.length > 0);
    if (incomplete.length > 0) {
      toast(`Turtle ${incomplete[0].idx} is missing: ${incomplete[0].missing.join(", ")}. Fill all required fields before submitting.`);
      return;
    }
  }

  const rows = buildRows(state.draft);
  const payload = { rows, schema: buildSchema() };

  state.queue.push({
    id: state.draft.id,
    queuedAt: new Date().toISOString(),
    payload,
  });
  saveQueue();
  updateQueuePill();

  state.draft.submitted = true;
  saveDraft();
  renderReview();

  if (!state.settings.syncUrl) {
    toast(`Queued ${rows.length} turtle row${rows.length === 1 ? "" : "s"} locally — add a Sheets URL in Settings to push.`);
    return;
  }

  try {
    await flushQueue();
    toast(`Submitted ${rows.length} turtle row${rows.length === 1 ? "" : "s"} to Google Sheets ✓`);
  } catch (e) {
    toast(`Sync failed (${e.message}). Rows queued, will retry when online.`);
  }
}

async function flushQueue() {
  if (!state.settings.syncUrl) return;
  if (!navigator.onLine) throw new Error("Offline");
  while (state.queue.length > 0) {
    const item = state.queue[0];
    // Apps Script web apps reject preflight (no custom headers) — use text/plain.
    // The shared secret rides inside the JSON body so it's never in a URL or
    // header (where it'd be more likely to leak via logs / referrers).
    const body = { ...item.payload, secret: SYNC_SECRET };
    const res = await fetch(state.settings.syncUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data && data.ok === false) throw new Error(data.error || "Apps Script error");
    state.queue.shift();
    saveQueue();
    updateQueuePill();
  }
}

/* =========================================================================
 *  PENDING SYNC QUEUE MODAL
 * ========================================================================= */

function relativeTime(iso) {
  if (!iso) return "queued";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function summarizeQueueItem(item) {
  const rows = (item.payload && item.payload.rows) || [];
  const site = rows[0] && rows[0].site;
  const date = rows[0] && rows[0].date;
  return {
    title: site ? `${site} · ${date || ""}`.trim() : "Sea turtle survey",
    detail: `${rows.length} turtle row${rows.length === 1 ? "" : "s"}`,
  };
}

function removeQueueItem(idx) {
  const item = state.queue[idx];
  // If this item matches the current draft, un-flag it so the user can re-submit.
  if (state.draft && item && item.id === state.draft.id) {
    state.draft.submitted = false;
    saveDraft();
  }
  state.queue.splice(idx, 1);
  saveQueue();
  updateQueuePill();
}

function openQueueModal() {
  const node = renderModal("tpl-queue-modal");
  const list = node.querySelector("#queue-list");
  const emptyHint = node.querySelector("#queue-empty-hint");
  const syncHint = node.querySelector("#queue-sync-hint");
  const retryBtn = node.querySelector("#queue-retry-btn");

  function render() {
    list.innerHTML = "";
    if (state.queue.length === 0) {
      emptyHint.classList.remove("hidden");
      retryBtn.disabled = true;
      syncHint.textContent = "";
      return;
    }
    emptyHint.classList.add("hidden");

    state.queue.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "queue-item";

      const top = document.createElement("div");
      top.className = "queue-item-top";

      const titleWrap = document.createElement("div");
      titleWrap.className = "queue-item-title-wrap";
      const summary = summarizeQueueItem(item);
      const title = document.createElement("div");
      title.className = "queue-item-title";
      title.textContent = summary.title;
      const detail = document.createElement("div");
      detail.className = "queue-item-detail muted small";
      detail.textContent = `${summary.detail} · ${relativeTime(item.queuedAt)}`;
      titleWrap.append(title, detail);
      top.appendChild(titleWrap);

      const rmBtn = document.createElement("button");
      rmBtn.className = "queue-item-remove";
      rmBtn.textContent = "Remove";
      rmBtn.title = "Drop this submission and re-enable the survey for re-submission";
      rmBtn.addEventListener("click", () => {
        if (!confirm(`Remove this queued submission?\n\n${summary.title}\n${summary.detail}`)) return;
        removeQueueItem(idx);
        render();
        if (state.current === "review") renderReview();
      });
      top.appendChild(rmBtn);

      card.appendChild(top);
      list.appendChild(card);
    });

    if (!state.settings.syncUrl) {
      syncHint.textContent = "No Sheets sync URL set in Settings — Retry won't push anywhere yet.";
      retryBtn.disabled = true;
    } else if (!navigator.onLine) {
      syncHint.textContent = "Offline — Retry will fail until the device is back online.";
      retryBtn.disabled = false;
    } else {
      syncHint.textContent = "";
      retryBtn.disabled = false;
    }
  }
  render();

  node.querySelector('[data-action="close"]').addEventListener("click", () => closeModal(node));
  retryBtn.addEventListener("click", async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying…";
    try {
      await flushQueue();
      toast("Queue flushed ✓");
      closeModal(node);
      if (state.current === "review") renderReview();
    } catch (e) {
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry now";
      toast(`Retry failed (${e.message})`);
      render();
    }
  });
}

function openSettings() {
  const node = renderModal("tpl-settings");
  node.querySelector("#sync-url").value = state.settings.syncUrl || "";
  node.querySelector("#auto-sync").checked = !!state.settings.autoSync;
  node.querySelector('[data-action="cancel"]').addEventListener("click", () => closeModal(node));
  node.querySelector('[data-action="save"]').addEventListener("click", () => {
    state.settings.syncUrl = node.querySelector("#sync-url").value.trim();
    state.settings.autoSync = node.querySelector("#auto-sync").checked;
    saveSettings();
    closeModal(node);
    toast("Settings saved");
    updateQueuePill();
  });
}

function renderModal(tplId) {
  const tpl = document.getElementById(tplId);
  const node = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(node);
  return node;
}
function closeModal(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

/* =========================================================================
 *  EXPORTS — JSON / CSV / TSV
 * ========================================================================= */

function exportJSON() {
  if (!state.draft && state.queue.length === 0) return;
  const data = state.draft
    ? { rows: buildRows(state.draft), schema: buildSchema() }
    : state.queue;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `sea-turtle-${stampForFilename()}.json`);
}

function downloadCSV() {
  if (!state.draft) return;
  const csv = surveyToDelimited(",");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `sea-turtle-${stampForFilename()}.csv`);
}

async function copyTSV() {
  if (!state.draft) return;
  const tsv = surveyToDelimited("\t");
  try {
    await navigator.clipboard.writeText(tsv);
    toast("Copied as TSV — paste into Sheets.");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied to clipboard."); }
    catch { toast("Could not copy — select and copy manually."); }
    ta.remove();
  }
}

function surveyToDelimited(sep) {
  const schema = buildSchema();
  const cols = [...schema.meta, ...schema.turtle];
  const rows = buildRows(state.draft);
  const lines = [cols.map(csvEscape).join(sep)];
  rows.forEach((r) => {
    lines.push(cols.map((c) => csvEscape(r[c] === undefined ? "" : r[c])).join(sep));
  });
  return lines.join("\n");
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\t\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function stampForFilename() {
  const meta = state.draft?.metadata || {};
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const loc = (meta.site || "survey").replace(/[^a-z0-9]+/gi, "_");
  return `${date}-${loc}`;
}

/* =========================================================================
 *  UI HELPERS
 * ========================================================================= */

function updateQueuePill() {
  const el = document.getElementById("queue-count");
  if (el) el.textContent = state.queue.length;
}

function updateNetStatus() {
  const dot = document.getElementById("net-status");
  if (!dot) return;
  dot.classList.toggle("offline", !navigator.onLine);
  dot.title = navigator.onLine ? "Online" : "Offline — submissions will queue";
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* =========================================================================
 *  BOOT
 * ========================================================================= */

function boot() {
  state.queue = loadQueue();
  state.settings = loadSettings();
  state.draft = loadDraft();
  updateQueuePill();
  updateNetStatus();

  document.querySelectorAll("#survey-tabs .tab").forEach((b) => {
    b.addEventListener("click", () => {
      if (!state.draft) return go("setup");
      go(b.dataset.screen);
    });
  });
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("queue-count").addEventListener("click", openQueueModal);

  window.addEventListener("online", () => {
    updateNetStatus();
    if (state.settings.autoSync && state.queue.length > 0) {
      flushQueue().catch(() => {});
    }
  });
  window.addEventListener("offline", updateNetStatus);

  go(state.draft ? "turtles" : "setup");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
