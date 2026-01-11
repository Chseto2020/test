"use strict";

const STORAGE_KEY = "taskpwa.tasks.v1";

const els = {
  form: document.getElementById("addForm"),
  title: document.getElementById("titleInput"),
  due: document.getElementById("dueInput"),
  list: document.getElementById("list"),
  stats: document.getElementById("stats"),
  search: document.getElementById("searchInput"),
  sort: document.getElementById("sortSelect"),
  exportBtn: document.getElementById("exportBtn"),
  importFile: document.getElementById("importFile"),
  clearDoneBtn: document.getElementById("clearDoneBtn"),
  filterBtns: Array.from(document.querySelectorAll(".segbtn")),
};

let state = {
  tasks: [],
  filter: "all",
  search: "",
  sort: "due",
};

init();

function init() {
  load();
  wire();
  render();
  registerServiceWorker();
}

function wire() {
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = els.title.value.trim();
    if (!title) return;

    const dueAt = parseDateTimeLocal(els.due.value); // null ok
    addTask(title, dueAt);

    els.title.value = "";
    els.due.value = "";
    els.title.focus();
  });

  els.filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter || "all";
      els.filterBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      render();
    });
  });

  els.search.addEventListener("input", () => {
    state.search = (els.search.value || "").trim().toLowerCase();
    render();
  });

  els.sort.addEventListener("change", () => {
    state.sort = els.sort.value;
    render();
  });

  els.exportBtn.addEventListener("click", exportJSON);

  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      importJSON(data);
      els.importFile.value = "";
    } catch {
      alert("読み込みに失敗しました（JSON形式を確認してください）");
      els.importFile.value = "";
    }
  });

  els.clearDoneBtn.addEventListener("click", () => {
    const before = state.tasks.length;
    state.tasks = state.tasks.filter((t) => !t.done);
    if (state.tasks.length !== before) {
      save();
      render();
    }
  });
}

function addTask(title, dueAt) {
  const now = Date.now();
  const task = {
    id: crypto.randomUUID(),
    title,
    done: false,
    createdAt: now,
    updatedAt: now,
    dueAt: dueAt ?? null,
  };
  state.tasks.unshift(task);
  save();
  render();
}

function toggleDone(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.updatedAt = Date.now();
  save();
  render();
}

function removeTask(id) {
  const i = state.tasks.findIndex((x) => x.id === id);
  if (i === -1) return;
  state.tasks.splice(i, 1);
  save();
  render();
}

function editTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;

  const title = prompt("タスク名を編集", t.title);
  if (title === null) return; // cancel
  const next = title.trim();
  if (!next) return;

  t.title = next;
  t.updatedAt = Date.now();
  save();
  render();
}

function editDue(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;

  const current = t.dueAt ? toDateTimeLocalValue(t.dueAt) : "";
  const input = prompt("期限（YYYY-MM-DDTHH:MM / 空で解除）", current);
  if (input === null) return;

  const trimmed = input.trim();
  if (!trimmed) {
    t.dueAt = null;
  } else {
    const parsed = parseDateTimeLocal(trimmed);
    if (parsed == null) {
      alert("形式が正しくありません。例：2026-01-12T09:30");
      return;
    }
    t.dueAt = parsed;
  }
  t.updatedAt = Date.now();
  save();
  render();
}

function getVisibleTasks() {
  const now = Date.now();
  let tasks = state.tasks.slice();

  if (state.filter === "active") tasks = tasks.filter((t) => !t.done);
  if (state.filter === "done") tasks = tasks.filter((t) => t.done);

  if (state.search) {
    tasks = tasks.filter((t) => t.title.toLowerCase().includes(state.search));
  }

  tasks.sort((a, b) => compareTasks(a, b, state.sort, now));
  return tasks;
}

function compareTasks(a, b, sort, now) {
  if (sort === "created_desc") return b.createdAt - a.createdAt;
  if (sort === "created_asc") return a.createdAt - b.createdAt;

  // due: 期限が近い順（期限なしは最後）
  const ad = a.dueAt ?? Number.POSITIVE_INFINITY;
  const bd = b.dueAt ?? Number.POSITIVE_INFINITY;

  // 期限が過ぎてるものを前へ（ただし完了は後ろ寄り）
  const aOver = (a.dueAt != null && a.dueAt < now && !a.done) ? 0 : 1;
  const bOver = (b.dueAt != null && b.dueAt < now && !b.done) ? 0 : 1;
  if (aOver !== bOver) return aOver - bOver;

  if (ad !== bd) return ad - bd;

  // 完了は後ろへ
  if (a.done !== b.done) return a.done ? 1 : -1;

  return b.updatedAt - a.updatedAt;
}

function render() {
  const tasks = getVisibleTasks();
  els.list.textContent = "";

  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.done).length;
  els.stats.textContent = `全 ${total} / 完了 ${done}`;

  if (tasks.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "タスクがありません。";
    els.list.appendChild(li);
    return;
  }

  const now = Date.now();
  for (const t of tasks) {
    els.list.appendChild(renderItem(t, now));
  }
}

function renderItem(t, now) {
  const li = document.createElement("li");
  li.className = "item";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "check";
  checkbox.checked = t.done;
  checkbox.addEventListener("change", () => toggleDone(t.id));

  const main = document.createElement("div");
  main.className = "itemmain";

  const title = document.createElement("p");
  title.className = "itemtitle";
  title.textContent = t.title;

  const meta = document.createElement("div");
  meta.className = "itemmeta";

  const created = document.createElement("span");
  created.className = "badge";
  created.textContent = `作成: ${fmtDateTime(t.createdAt)}`;

  meta.appendChild(created);

  if (t.dueAt != null) {
    const due = document.createElement("span");
    const overdue = (!t.done && t.dueAt < now);
    due.className = `badge ${overdue ? "overdue" : ""}`;
    due.textContent = `期限: ${fmtDateTime(t.dueAt)}${overdue ? "（期限切れ）" : ""}`;
    meta.appendChild(due);
  }

  if (t.done) {
    const doneBadge = document.createElement("span");
    doneBadge.className = "badge";
    doneBadge.textContent = "完了";
    meta.appendChild(doneBadge);
  }

  main.appendChild(title);
  main.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "itemactions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "iconbtn";
  editBtn.textContent = "編集";
  editBtn.addEventListener("click", () => editTask(t.id));

  const dueBtn = document.createElement("button");
  dueBtn.type = "button";
  dueBtn.className = "iconbtn";
  dueBtn.textContent = "期限";
  dueBtn.addEventListener("click", () => editDue(t.id));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "iconbtn danger";
  delBtn.textContent = "削除";
  delBtn.addEventListener("click", () => removeTask(t.id));

  actions.appendChild(editBtn);
  actions.appendChild(dueBtn);
  actions.appendChild(delBtn);

  li.appendChild(checkbox);
  li.appendChild(main);
  li.appendChild(actions);
  return li;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return;
    // 最低限のバリデーション
    state.tasks = data
      .filter((x) => x && typeof x.id === "string" && typeof x.title === "string")
      .map((x) => ({
        id: x.id,
        title: x.title,
        done: Boolean(x.done),
        createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
        updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : Date.now(),
        dueAt: typeof x.dueAt === "number" ? x.dueAt : null,
      }));
  } catch {
    // 破損してたら無視（必要ならここで復旧UI）
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function exportJSON() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: state.tasks,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `tasks-backup-${yyyyMMdd()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(data) {
  if (!data || typeof data !== "object") {
    alert("JSONの形式が正しくありません");
    return;
  }
  const tasks = Array.isArray(data.tasks) ? data.tasks : (Array.isArray(data) ? data : null);
  if (!tasks) {
    alert("JSONの形式が正しくありません（tasks配列が見つかりません）");
    return;
  }

  const cleaned = tasks
    .filter((x) => x && typeof x.id === "string" && typeof x.title === "string")
    .map((x) => ({
      id: x.id,
      title: x.title,
      done: Boolean(x.done),
      createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
      updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : Date.now(),
      dueAt: typeof x.dueAt === "number" ? x.dueAt : null,
    }));

  // id重複を避けてマージ
  const map = new Map(state.tasks.map((t) => [t.id, t]));
  for (const t of cleaned) map.set(t.id, t);
  state.tasks = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);

  save();
  render();
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  // value: "YYYY-MM-DDTHH:MM"
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

function fmtDateTime(ms) {
  const d = new Date(ms);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function yyyyMMdd() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function registerServiceWorker() {
  // Service WorkerはHTTPSなどのセキュアコンテキストが前提（GitHub PagesはHTTPS対応） :contentReference[oaicite:2]{index=2}
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch {
      // 登録失敗時は黙って通常動作
    }
  });
}
