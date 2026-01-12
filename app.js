"use strict";

/**
 * Local-only Task PWA
 * - one-off tasks
 * - recurring tasks (DAY/WEEK/MONTH) using template + period state
 * - gem reward on complete
 * - coin manual update (calculator UI)
 * - settings: delete recurring templates individually
 */

const STORAGE_KEY = "taskpwa.data.v2";
const LEGACY_TASKS_KEY = "taskpwa.tasks.v1";

const els = {
  // top
  dateLabel: document.getElementById("dateLabel"),
  weekdayLabel: document.getElementById("weekdayLabel"),
  timeLabel: document.getElementById("timeLabel"),
  gemCount: document.getElementById("gemCount"),
  coinCount: document.getElementById("coinCount"),
  coinBtn: document.getElementById("coinBtn"),
  menuBtn: document.getElementById("menuBtn"),

  // tabs/list
  tabs: Array.from(document.querySelectorAll(".tab")),
  openAddBtn: document.getElementById("openAddBtn"),
  taskList: document.getElementById("taskList"),
  emptyHint: document.getElementById("emptyHint"),

  // pinned
  pinnedBar: document.getElementById("pinnedBar"),
  pinnedCheck: document.getElementById("pinnedCheck"),
  pinnedTitle: document.getElementById("pinnedTitle"),
  pinnedMeta: document.getElementById("pinnedMeta"),
  pinnedEditBtn: document.getElementById("pinnedEditBtn"),

  // overlays
  menuOverlay: document.getElementById("menuOverlay"),
  taskOverlay: document.getElementById("taskOverlay"),
  settingsOverlay: document.getElementById("settingsOverlay"),
  coinOverlay: document.getElementById("coinOverlay"),

  // menu
  openSettingsBtn: document.getElementById("openSettingsBtn"),

  // task editor
  taskSheetTitle: document.getElementById("taskSheetTitle"),
  taskForm: document.getElementById("taskForm"),
  taskTitle: document.getElementById("taskTitle"),
  taskMemo: document.getElementById("taskMemo"),
  taskKind: document.getElementById("taskKind"),
  dueField: document.getElementById("dueField"),
  taskDue: document.getElementById("taskDue"),
  recurringField: document.getElementById("recurringField"),
  taskRecurringType: document.getElementById("taskRecurringType"),
  taskGem: document.getElementById("taskGem"),
  taskGemNumber: document.getElementById("taskGemNumber"),
  deleteTaskBtn: document.getElementById("deleteTaskBtn"),
  recurringDeleteHint: document.getElementById("recurringDeleteHint"),

  // settings
  recurringList: document.getElementById("recurringList"),
  recurringEmpty: document.getElementById("recurringEmpty"),

  // calc
  calcCurrent: document.getElementById("calcCurrent"),
  calcPreview: document.getElementById("calcPreview"),
  calcEntry: document.getElementById("calcEntry"),
};

let state = {
  view: "DAY", // DAY | WEEK | MONTH
  data: defaultData(),
  editor: {
    mode: "add", // add | edit
    kind: "ONE_OFF", // ONE_OFF | RECURRING
    targetId: null, // one-off id OR recurring template id
  },
  calc: {
    entry: "0",
    current: 0,
    preview: 0,
  },
};

init();

function init() {
  state.data = loadData();
  wireGlobal();
  wireTabs();
  wireTaskEditor();
  wireSettings();
  wireCalculator();
  updateClock();
  setInterval(updateClock, 30 * 1000);

  renderAll();
  registerServiceWorker();
}

/* ---------------- data model ---------------- */

function defaultData() {
  return {
    version: 2,
    gems: 0,
    coins: 0,
    oneOffTasks: [],
    recurringTemplates: [], // {id,title,memo,type,gem,createdAt,updatedAt}
    recurringStates: {}, // key: `${templateId}:${periodKey}` => {done:boolean, doneAt:number|null}
  };
}

function loadData() {
  // v2
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const cleaned = sanitizeData(parsed);
      if (cleaned) return cleaned;
    }
  } catch {}

  // migrate legacy tasks list (from earlier simple app)
  try {
    const legacy = localStorage.getItem(LEGACY_TASKS_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy);
      if (Array.isArray(arr)) {
        const d = defaultData();
        d.oneOffTasks = arr
          .filter((x) => x && typeof x.id === "string" && typeof x.title === "string")
          .map((x) => ({
            id: x.id,
            title: x.title,
            memo: "",
            dueAt: (typeof x.dueAt === "number" ? x.dueAt : null),
            gem: 0,
            done: Boolean(x.done),
            createdAt: (typeof x.createdAt === "number" ? x.createdAt : Date.now()),
            updatedAt: (typeof x.updatedAt === "number" ? x.updatedAt : Date.now()),
            doneAt: null,
          }));
        saveData(d);
        return d;
      }
    }
  } catch {}

  return defaultData();
}

function sanitizeData(input) {
  if (!input || typeof input !== "object") return null;

  const d = defaultData();

  d.gems = safeInt(input.gems, 0);
  d.coins = safeInt(input.coins, 0);

  if (Array.isArray(input.oneOffTasks)) {
    d.oneOffTasks = input.oneOffTasks
      .filter((t) => t && typeof t.id === "string" && typeof t.title === "string")
      .map((t) => ({
        id: t.id,
        title: String(t.title),
        memo: typeof t.memo === "string" ? t.memo : "",
        dueAt: typeof t.dueAt === "number" ? t.dueAt : null,
        gem: clamp(safeInt(t.gem, 0), 0, 100),
        done: Boolean(t.done),
        createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
        updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
        doneAt: typeof t.doneAt === "number" ? t.doneAt : null,
      }));
  }

  if (Array.isArray(input.recurringTemplates)) {
    d.recurringTemplates = input.recurringTemplates
      .filter((t) => t && typeof t.id === "string" && typeof t.title === "string")
      .map((t) => ({
        id: t.id,
        title: String(t.title),
        memo: typeof t.memo === "string" ? t.memo : "",
        type: normalizeRecurringType(t.type),
        gem: clamp(safeInt(t.gem, 0), 0, 100),
        createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
        updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
      }));
  }

  if (input.recurringStates && typeof input.recurringStates === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input.recurringStates)) {
      if (!k || typeof k !== "string") continue;
      if (!v || typeof v !== "object") continue;
      out[k] = {
        done: Boolean(v.done),
        doneAt: typeof v.doneAt === "number" ? v.doneAt : null,
      };
    }
    d.recurringStates = out;
  }

  return d;
}

function saveData(next = state.data) {
  state.data = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

/* ---------------- UI wiring ---------------- */

function wireGlobal() {
  // overlay close
  document.body.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const closeId = target.getAttribute("data-close");
    if (closeId) {
      hideOverlay(closeId);
      return;
    }
  });

  els.menuBtn.addEventListener("click", () => showOverlay("menuOverlay"));

  els.openSettingsBtn.addEventListener("click", () => {
    hideOverlay("menuOverlay");
    renderSettings();
    showOverlay("settingsOverlay");
  });

  els.coinBtn.addEventListener("click", () => openCoinCalculator());

  els.openAddBtn.addEventListener("click", () => openTaskEditorAdd());

  els.pinnedEditBtn.addEventListener("click", () => {
    const info = els.pinnedBar.dataset.target;
    if (!info) return;
    const [kind, id] = info.split(":");
    if (!kind || !id) return;
    openTaskEditorEdit(kind, id);
  });

  els.pinnedCheck.addEventListener("change", () => {
    const info = els.pinnedBar.dataset.target;
    if (!info) return;
    const [kind, id] = info.split(":");
    if (!kind || !id) return;
    toggleTaskDone(kind, id);
  });
}

function wireTabs() {
  els.tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view || "DAY";
      els.tabs.forEach((b) => b.classList.toggle("is-active", b === btn));
      renderAll();
    });
  });
}

function wireTaskEditor() {
  els.taskKind.addEventListener("change", () => {
    const kind = els.taskKind.value === "RECURRING" ? "RECURRING" : "ONE_OFF";
    setEditorKindUI(kind);
  });

  // gem sync
  els.taskGem.addEventListener("input", () => {
    els.taskGemNumber.value = String(els.taskGem.value);
  });
  els.taskGemNumber.addEventListener("input", () => {
    const v = clamp(safeInt(els.taskGemNumber.value, 0), 0, 100);
    els.taskGemNumber.value = String(v);
    els.taskGem.value = String(v);
  });

  els.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveTaskFromEditor();
  });

  els.deleteTaskBtn.addEventListener("click", () => {
    const { kind, targetId } = state.editor;
    if (!targetId) return;
    if (kind !== "ONE_OFF") return;

    const ok = confirm("このタスクを削除しますか？");
    if (!ok) return;

    deleteOneOffTask(targetId);
    hideOverlay("taskOverlay");
    renderAll();
  });
}

function wireSettings() {
  // delete recurring template (individual)
  els.recurringList.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.getAttribute("data-del-template");
    if (!id) return;

    const tpl = state.data.recurringTemplates.find((t) => t.id === id);
    if (!tpl) return;

    const ok = confirm(`常在タスク「${tpl.title}」を削除しますか？`);
    if (!ok) return;

    deleteRecurringTemplate(id);
    renderAll();
  });
}

function wireCalculator() {
  els.coinOverlay.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const digit = target.getAttribute("data-digit");
    const act = target.getAttribute("data-calc");

    if (digit != null) {
      calcAppendDigit(digit);
      return;
    }
    if (act) {
      calcAction(act);
      return;
    }
  });
}

/* ---------------- clock ---------------- */

function updateClock() {
  const now = new Date();
  const date = new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("ja-JP", { weekday: "short" }).format(now);
  const time = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(now);

  els.dateLabel.textContent = date;
  els.weekdayLabel.textContent = weekday;
  els.timeLabel.textContent = time;

  // remaining times tick
  renderPinned(); // keep simple
  renderTaskList(); // countdown updates
}

/* ---------------- render ---------------- */

function renderAll() {
  renderHeader();
  renderTaskList();
  renderPinned();
  renderSettings(); // keep in sync
}

function renderHeader() {
  els.gemCount.textContent = String(state.data.gems);
  els.coinCount.textContent = String(state.data.coins);
}

function renderTaskList() {
  const items = buildVisibleItems();
  els.taskList.textContent = "";

  if (items.length === 0) {
    els.emptyHint.hidden = false;
    return;
  }
  els.emptyHint.hidden = true;

  const focusKey = getPinnedCandidateKey(items);

  for (const it of items) {
    const li = document.createElement("li");
    li.className = "task";
    if (focusKey && it.key === focusKey) li.classList.add("is-focus");

    const checkWrap = document.createElement("div");
    checkWrap.className = "task__check";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = it.done;
    check.addEventListener("change", () => toggleTaskDone(it.kind, it.id));
    checkWrap.appendChild(check);

    const main = document.createElement("div");
    main.className = "task__main";

    const title = document.createElement("p");
    title.className = "task__title";
    title.textContent = it.title;

    const meta = document.createElement("div");
    meta.className = "task__meta";

    // remaining / recurring label
    if (it.kind === "ONE_OFF") {
      if (it.dueAt != null && !it.done) {
        const b = document.createElement("span");
        const { text, overdue } = formatRemainingBadge(it.dueAt);
        b.className = `badge ${overdue ? "overdue" : ""}`;
        b.textContent = text;
        meta.appendChild(b);
      } else if (it.dueAt != null && it.done) {
        const b = document.createElement("span");
        b.className = "badge";
        b.textContent = "完了";
        meta.appendChild(b);
      }
    } else {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = `常在タスク（${it.recurringType}）`;
      meta.appendChild(b);
    }

    // gem
    const gem = document.createElement("span");
    gem.className = "badge gem";
    gem.textContent = `💎 ${it.gem}`;
    meta.appendChild(gem);

    main.appendChild(title);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "task__actions";

    const edit = document.createElement("button");
    edit.className = "iconbtn";
    edit.type = "button";
    edit.textContent = "⋯";
    edit.setAttribute("aria-label", "編集");
    edit.addEventListener("click", () => openTaskEditorEdit(it.kind, it.id));
    actions.appendChild(edit);

    li.appendChild(checkWrap);
    li.appendChild(main);
    li.appendChild(actions);

    els.taskList.appendChild(li);
  }
}

function renderPinned() {
  const items = buildVisibleItems({ includeAllForPinned: true });

  const target = pickPinnedTarget(items);
  if (!target) {
    els.pinnedBar.hidden = true;
    els.pinnedBar.dataset.target = "";
    return;
  }

  els.pinnedBar.hidden = false;
  els.pinnedBar.dataset.target = `${target.kind}:${target.id}`;
  els.pinnedCheck.checked = target.done;

  els.pinnedTitle.textContent = target.title;

  if (target.kind === "ONE_OFF" && target.dueAt != null && !target.done) {
    const { text } = formatRemainingBadge(target.dueAt);
    els.pinnedMeta.textContent = text;
  } else if (target.kind === "RECURRING") {
    els.pinnedMeta.textContent = `常在タスク（${target.recurringType}）`;
  } else {
    els.pinnedMeta.textContent = `💎 ${target.gem}`;
  }
}

function renderSettings() {
  const tpls = state.data.recurringTemplates.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  els.recurringList.textContent = "";
  if (tpls.length === 0) {
    els.recurringEmpty.hidden = false;
    return;
  }
  els.recurringEmpty.hidden = true;

  for (const t of tpls) {
    const li = document.createElement("li");
    li.className = "simpleitem";

    const main = document.createElement("div");
    main.className = "simpleitem__main";

    const title = document.createElement("p");
    title.className = "simpleitem__title";
    title.textContent = t.title;

    const meta = document.createElement("div");
    meta.className = "simpleitem__meta";

    const b1 = document.createElement("span");
    b1.className = "badge";
    b1.textContent = `常在（${t.type}）`;

    const b2 = document.createElement("span");
    b2.className = "badge gem";
    b2.textContent = `💎 ${t.gem}`;

    meta.appendChild(b1);
    meta.appendChild(b2);

    main.appendChild(title);
    main.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "simpleitem__actions";

    const del = document.createElement("button");
    del.className = "btn btn--danger";
    del.type = "button";
    del.textContent = "削除";
    del.setAttribute("data-del-template", t.id);

    actions.appendChild(del);

    li.appendChild(main);
    li.appendChild(actions);
    els.recurringList.appendChild(li);
  }
}

/* ---------------- build list items ---------------- */

function buildVisibleItems(opts = {}) {
  const { includeAllForPinned = false } = opts;
  const { start, end, periodKey } = getPeriodInfo(state.view);

  const items = [];

  // recurring for current view
  for (const tpl of state.data.recurringTemplates) {
    if (!includeAllForPinned && tpl.type !== state.view) continue;

    const key = recurringStateKey(tpl.id, getPeriodKey(tpl.type));
    const st = state.data.recurringStates[key] || { done: false, doneAt: null };

    items.push({
      key: `R:${tpl.id}:${getPeriodKey(tpl.type)}`,
      kind: "RECURRING",
      id: tpl.id,
      title: tpl.title,
      memo: tpl.memo,
      recurringType: tpl.type,
      done: Boolean(st.done),
      gem: tpl.gem,
      dueAt: null,
      sortDue: Number.POSITIVE_INFINITY,
      sortOver: 1,
      sortDone: st.done ? 1 : 0,
    });
  }

  // one-off filtered by period
  for (const t of state.data.oneOffTasks) {
    if (!includeAllForPinned) {
      // show no-due tasks only on DAY
      if (t.dueAt == null) {
        if (state.view !== "DAY") continue;
      } else {
        if (!(t.dueAt >= start && t.dueAt < end)) continue;
      }
    }

    const due = t.dueAt;
    const over = (due != null && !t.done && due < Date.now()) ? 0 : 1;

    items.push({
      key: `O:${t.id}`,
      kind: "ONE_OFF",
      id: t.id,
      title: t.title,
      memo: t.memo,
      recurringType: null,
      done: Boolean(t.done),
      gem: t.gem,
      dueAt: due,
      sortDue: (due == null ? Number.POSITIVE_INFINITY : due),
      sortOver: over,
      sortDone: t.done ? 1 : 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    });
  }

  // sort: overdue first, then due soon, then not-done before done, then updated desc
  items.sort((a, b) => {
    // not-done before done
    if (a.sortDone !== b.sortDone) return a.sortDone - b.sortDone;

    // overdue first (only for one-off)
    if (a.sortOver !== b.sortOver) return a.sortOver - b.sortOver;

    // due ascending
    if (a.sortDue !== b.sortDue) return a.sortDue - b.sortDue;

    // recurring before no-due one-offs (optional)
    if (a.kind !== b.kind) return a.kind === "RECURRING" ? -1 : 1;

    const au = a.updatedAt || 0;
    const bu = b.updatedAt || 0;
    return bu - au;
  });

  return items;
}

function pickPinnedTarget(items) {
  // Prefer one-off with dueAt and not done (overdue first then soonest)
  const now = Date.now();
  const candidates = items
    .filter((x) => !x.done)
    .sort((a, b) => {
      const aDue = a.kind === "ONE_OFF" && a.dueAt != null ? a.dueAt : Number.POSITIVE_INFINITY;
      const bDue = b.kind === "ONE_OFF" && b.dueAt != null ? b.dueAt : Number.POSITIVE_INFINITY;

      const aOver = (a.kind === "ONE_OFF" && a.dueAt != null && a.dueAt < now) ? 0 : 1;
      const bOver = (b.kind === "ONE_OFF" && b.dueAt != null && b.dueAt < now) ? 0 : 1;

      if (aOver !== bOver) return aOver - bOver;
      if (aDue !== bDue) return aDue - bDue;

      // fallback: recurring first
      if (a.kind !== b.kind) return a.kind === "RECURRING" ? -1 : 1;
      return 0;
    });

  if (candidates.length > 0) return candidates[0];

  // otherwise show earliest done? hide
  return null;
}

function getPinnedCandidateKey(items) {
  const t = pickPinnedTarget(items);
  return t ? t.key : null;
}

/* ---------------- task operations ---------------- */

function toggleTaskDone(kind, id) {
  if (kind === "ONE_OFF") {
    const t = state.data.oneOffTasks.find((x) => x.id === id);
    if (!t) return;

    const nextDone = !t.done;
    t.done = nextDone;
    t.updatedAt = Date.now();
    t.doneAt = nextDone ? Date.now() : null;

    // gems +/- (keep consistent)
    state.data.gems = safeInt(state.data.gems, 0) + (nextDone ? t.gem : -t.gem);
    if (state.data.gems < 0) state.data.gems = 0;

    saveData(state.data);
    renderAll();
    return;
  }

  if (kind === "RECURRING") {
    const tpl = state.data.recurringTemplates.find((x) => x.id === id);
    if (!tpl) return;

    const pk = getPeriodKey(tpl.type);
    const k = recurringStateKey(tpl.id, pk);
    const prev = state.data.recurringStates[k] || { done: false, doneAt: null };

    const nextDone = !prev.done;
    state.data.recurringStates[k] = {
      done: nextDone,
      doneAt: nextDone ? Date.now() : null,
    };

    state.data.gems = safeInt(state.data.gems, 0) + (nextDone ? tpl.gem : -tpl.gem);
    if (state.data.gems < 0) state.data.gems = 0;

    saveData(state.data);
    renderAll();
  }
}

function openTaskEditorAdd() {
  state.editor.mode = "add";
  state.editor.kind = "ONE_OFF";
  state.editor.targetId = null;

  els.taskSheetTitle.textContent = "タスク追加";
  els.taskKind.value = "ONE_OFF";
  setEditorKindUI("ONE_OFF");

  els.taskTitle.value = "";
  els.taskMemo.value = "";
  els.taskDue.value = "";
  setGemEditor(0);
  els.taskRecurringType.value = state.view;

  els.deleteTaskBtn.classList.add("hidden");
  els.recurringDeleteHint.classList.add("hidden");

  showOverlay("taskOverlay");
  els.taskTitle.focus();
}

function openTaskEditorEdit(kind, id) {
  if (kind === "ONE_OFF") {
    const t = state.data.oneOffTasks.find((x) => x.id === id);
    if (!t) return;

    state.editor.mode = "edit";
    state.editor.kind = "ONE_OFF";
    state.editor.targetId = id;

    els.taskSheetTitle.textContent = "タスク編集";
    els.taskKind.value = "ONE_OFF";
    setEditorKindUI("ONE_OFF");

    els.taskTitle.value = t.title;
    els.taskMemo.value = t.memo || "";
    els.taskDue.value = t.dueAt != null ? toDateTimeLocalValue(t.dueAt) : "";
    setGemEditor(t.gem);

    els.deleteTaskBtn.classList.remove("hidden");
    els.recurringDeleteHint.classList.add("hidden");

    showOverlay("taskOverlay");
    return;
  }

  if (kind === "RECURRING") {
    const tpl = state.data.recurringTemplates.find((x) => x.id === id);
    if (!tpl) return;

    state.editor.mode = "edit";
    state.editor.kind = "RECURRING";
    state.editor.targetId = id;

    els.taskSheetTitle.textContent = "タスク編集";
    els.taskKind.value = "RECURRING";
    setEditorKindUI("RECURRING");

    els.taskTitle.value = tpl.title;
    els.taskMemo.value = tpl.memo || "";
    els.taskDue.value = "";
    els.taskRecurringType.value = tpl.type;
    setGemEditor(tpl.gem);

    // no delete here (as requested)
    els.deleteTaskBtn.classList.add("hidden");
    els.recurringDeleteHint.classList.remove("hidden");

    showOverlay("taskOverlay");
  }
}

function setGemEditor(v) {
  const gem = clamp(safeInt(v, 0), 0, 100);
  els.taskGem.value = String(gem);
  els.taskGemNumber.value = String(gem);
}

function setEditorKindUI(kind) {
  state.editor.kind = kind;

  if (kind === "ONE_OFF") {
    els.dueField.classList.remove("hidden");
    els.recurringField.classList.add("hidden");
    els.recurringDeleteHint.classList.add("hidden");
    // delete button only in edit mode
    if (state.editor.mode === "edit") els.deleteTaskBtn.classList.remove("hidden");
  } else {
    els.dueField.classList.add("hidden");
    els.recurringField.classList.remove("hidden");
    els.deleteTaskBtn.classList.add("hidden");
    els.recurringDeleteHint.classList.toggle("hidden", state.editor.mode !== "edit");
  }
}

function saveTaskFromEditor() {
  const title = els.taskTitle.value.trim();
  if (!title) return;

  const memo = els.taskMemo.value || "";
  const gem = clamp(safeInt(els.taskGemNumber.value, 0), 0, 100);

  const kind = els.taskKind.value === "RECURRING" ? "RECURRING" : "ONE_OFF";

  if (state.editor.mode === "add") {
    if (kind === "ONE_OFF") {
      const dueAt = parseDateTimeLocal(els.taskDue.value);
      const now = Date.now();

      state.data.oneOffTasks.unshift({
        id: crypto.randomUUID(),
        title,
        memo,
        dueAt,
        gem,
        done: false,
        doneAt: null,
        createdAt: now,
        updatedAt: now,
      });

      saveData(state.data);
      hideOverlay("taskOverlay");
      renderAll();
      return;
    }

    // add recurring template
    const rType = normalizeRecurringType(els.taskRecurringType.value);
    const now = Date.now();

    state.data.recurringTemplates.unshift({
      id: crypto.randomUUID(),
      title,
      memo,
      type: rType,
      gem,
      createdAt: now,
      updatedAt: now,
    });

    saveData(state.data);
    hideOverlay("taskOverlay");
    renderAll();
    return;
  }

  // edit mode
  if (!state.editor.targetId) return;

  if (state.editor.kind === "ONE_OFF") {
    const t = state.data.oneOffTasks.find((x) => x.id === state.editor.targetId);
    if (!t) return;

    t.title = title;
    t.memo = memo;
    t.gem = gem;
    t.dueAt = parseDateTimeLocal(els.taskDue.value);
    t.updatedAt = Date.now();

    saveData(state.data);
    hideOverlay("taskOverlay");
    renderAll();
    return;
  }

  if (state.editor.kind === "RECURRING") {
    const tpl = state.data.recurringTemplates.find((x) => x.id === state.editor.targetId);
    if (!tpl) return;

    tpl.title = title;
    tpl.memo = memo;
    tpl.gem = gem;
    tpl.type = normalizeRecurringType(els.taskRecurringType.value);
    tpl.updatedAt = Date.now();

    saveData(state.data);
    hideOverlay("taskOverlay");
    renderAll();
  }
}

function deleteOneOffTask(id) {
  const t = state.data.oneOffTasks.find((x) => x.id === id);
  if (t && t.done) {
    // keep gems consistent
    state.data.gems = Math.max(0, safeInt(state.data.gems, 0) - t.gem);
  }
  state.data.oneOffTasks = state.data.oneOffTasks.filter((x) => x.id !== id);
  saveData(state.data);
}

function deleteRecurringTemplate(id) {
  // if current period state is done, remove its gem? (keep consistent)
  const tpl = state.data.recurringTemplates.find((x) => x.id === id);
  if (tpl) {
    const pk = getPeriodKey(tpl.type);
    const key = recurringStateKey(tpl.id, pk);
    const st = state.data.recurringStates[key];
    if (st?.done) {
      state.data.gems = Math.max(0, safeInt(state.data.gems, 0) - tpl.gem);
    }
  }

  state.data.recurringTemplates = state.data.recurringTemplates.filter((x) => x.id !== id);

  // remove all states of this template
  const nextStates = {};
  for (const [k, v] of Object.entries(state.data.recurringStates)) {
    if (!k.startsWith(id + ":")) nextStates[k] = v;
  }
  state.data.recurringStates = nextStates;

  saveData(state.data);
}

/* ---------------- period helpers ---------------- */

function getPeriodInfo(view) {
  if (view === "WEEK") return weekPeriod();
  if (view === "MONTH") return monthPeriod();
  return dayPeriod();
}

function dayPeriod() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  return { start, end, periodKey: getPeriodKey("DAY") };
}

function weekPeriod() {
  const now = new Date();
  const d = new Date(now);
  // ISO week start (Monday)
  const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  const end = start + 7 * 24 * 60 * 60 * 1000;
  return { start, end, periodKey: getPeriodKey("WEEK") };
}

function monthPeriod() {
  const now = new Date();
  const startD = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const endD = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start: startD.getTime(), end: endD.getTime(), periodKey: getPeriodKey("MONTH") };
}

function getPeriodKey(type) {
  if (type === "WEEK") return isoWeekKey(new Date());
  if (type === "MONTH") return yyyyMM(new Date());
  return yyyyMMdd(new Date());
}

function recurringStateKey(templateId, periodKey) {
  return `${templateId}:${periodKey}`;
}

// ISO week key "YYYY-Www"
function isoWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  // Thursday in current week decides the year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const weekYear = d.getFullYear();

  // week 1 is the week with Jan 4th
  const week1 = new Date(weekYear, 0, 4);
  week1.setHours(0, 0, 0, 0);
  const week1Thursday = new Date(week1);
  week1Thursday.setDate(week1Thursday.getDate() + 3 - ((week1Thursday.getDay() + 6) % 7));

  const diff = d.getTime() - week1Thursday.getTime();
  const weekNo = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));

  return `${weekYear}-W${String(weekNo).padStart(2, "0")}`;
}

function yyyyMMdd(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yyyyMM(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/* ---------------- remaining time ---------------- */

function formatRemainingBadge(dueAt) {
  const now = Date.now();
  const diff = dueAt - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);

  const days = Math.floor(abs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((abs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
  const secs = Math.floor((abs % (60 * 1000)) / 1000);

  const hh = String(hours).padStart(1, "0");
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  const base = `${days}日 ${hh}:${mm}:${ss}`;
  return {
    overdue,
    text: overdue ? `期限切れ ${base}` : base,
  };
}

/* ---------------- calculator ---------------- */

function openCoinCalculator() {
  state.calc.current = safeInt(state.data.coins, 0);
  state.calc.preview = state.calc.current;
  state.calc.entry = "0";

  els.calcCurrent.textContent = String(state.calc.current);
  els.calcPreview.textContent = String(state.calc.preview);
  els.calcEntry.textContent = state.calc.entry;

  showOverlay("coinOverlay");
}

function calcAppendDigit(d) {
  if (!/^\d$/.test(d)) return;
  let s = state.calc.entry;

  if (s === "0") s = d;
  else if (s.length < 12) s += d;

  state.calc.entry = s;
  els.calcEntry.textContent = state.calc.entry;
}

function calcAction(act) {
  if (act === "clear") {
    state.calc.entry = "0";
    els.calcEntry.textContent = state.calc.entry;
    return;
  }
  if (act === "back") {
    let s = state.calc.entry;
    if (s.length <= 1) s = "0";
    else s = s.slice(0, -1);
    state.calc.entry = s;
    els.calcEntry.textContent = state.calc.entry;
    return;
  }

  const n = safeInt(state.calc.entry, 0);

  if (act === "add") {
    state.calc.preview = safeInt(state.calc.preview, 0) + n;
    state.calc.entry = "0";
    updateCalcPreview();
    return;
  }
  if (act === "sub") {
    state.calc.preview = safeInt(state.calc.preview, 0) - n;
    if (state.calc.preview < 0) state.calc.preview = 0;
    state.calc.entry = "0";
    updateCalcPreview();
    return;
  }
  if (act === "ok") {
    state.data.coins = safeInt(state.calc.preview, 0);
    saveData(state.data);
    renderHeader();
    hideOverlay("coinOverlay");
  }
}

function updateCalcPreview() {
  els.calcPreview.textContent = String(state.calc.preview);
  els.calcEntry.textContent = state.calc.entry;
}

/* ---------------- overlays ---------------- */

function showOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
}

function hideOverlay(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
}

/* ---------------- date helpers (editor) ---------------- */

function parseDateTimeLocal(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toDateTimeLocalValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${yyyy}-${MM}-${dd}T${hh}:${mm}`;
}

/* ---------------- utils ---------------- */

function safeInt(v, fallback = 0) {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function normalizeRecurringType(v) {
  const s = String(v || "").toUpperCase();
  if (s === "WEEK") return "WEEK";
  if (s === "MONTH") return "MONTH";
  return "DAY";
}

/* ---------------- service worker ---------------- */

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch {}
  });
}
