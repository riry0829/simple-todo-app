// シンプルな ToDo リスト — localStorage で保存
const STORAGE_KEY = "simple-todo-app";

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const dateInput = document.getElementById("todo-date");
const todaySection = document.getElementById("today-section");
const todayList = document.getElementById("today-list");
const todayCount = document.getElementById("today-count");
const activeList = document.getElementById("active-list");
const doneList = document.getElementById("done-list");
const activeEmpty = document.getElementById("active-empty");
const doneEmpty = document.getElementById("done-empty");
const activeCount = document.getElementById("active-count");
const doneCount = document.getElementById("done-count");
const countEl = document.getElementById("count");
const clearDoneBtn = document.getElementById("clear-done");

/** @type {{id: string|number, text: string, done: boolean, due: string|null, updatedAt: number}[]} */
let todos = [];
/** 削除済みタスクの記録（同期で削除を反映するため）: { [id]: 削除時刻 } */
let tombstones = {};
loadState();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalize(t) {
  return {
    id: t.id,
    text: t.text,
    done: !!t.done,
    due: t.due || null,
    updatedAt: t.updatedAt || t.id || Date.now(),
  };
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(raw)) {
      // 旧フォーマット（配列）からの移行
      todos = raw.map(normalize);
      tombstones = {};
    } else if (raw && Array.isArray(raw.todos)) {
      todos = raw.todos.map(normalize);
      tombstones = raw.tombstones || {};
    } else {
      todos = [];
      tombstones = {};
    }
  } catch {
    todos = [];
    tombstones = {};
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ todos, tombstones }));
}

function scheduleSync() {
  if (window.DriveSync) window.DriveSync.scheduleSync();
}

function createItem(todo) {
  const li = document.createElement("li");
  li.className = "todo-item" + (todo.done ? " done" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = todo.done;
  checkbox.addEventListener("change", () => toggle(todo.id));

  const body = document.createElement("div");
  body.className = "todo-body";

  const span = document.createElement("span");
  span.className = "todo-text";
  span.textContent = todo.text;
  body.appendChild(span);

  if (todo.due) {
    const due = document.createElement("span");
    due.className = "todo-due";
    due.textContent = "📅 " + formatDue(todo.due);
    if (!todo.done && isOverdue(todo.due)) due.classList.add("overdue");
    body.appendChild(due);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "delete-btn";
  delBtn.textContent = "✕";
  delBtn.setAttribute("aria-label", "削除");
  delBtn.addEventListener("click", () => remove(todo.id));

  li.append(checkbox, body, delBtn);
  return li;
}

// 期限ありを日付の昇順に、期限なしは末尾に並べる
function byDue(a, b) {
  if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
  if (a.due) return -1;
  if (b.due) return 1;
  return 0;
}

function formatDue(due) {
  const d = new Date(due + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function isToday(due) {
  const t = new Date();
  const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(t.getDate()).padStart(2, "0")}`;
  return due === ymd;
}

function isOverdue(due) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(due + "T00:00:00") < today;
}

function render() {
  todayList.innerHTML = "";
  activeList.innerHTML = "";
  doneList.innerHTML = "";

  // 未完了のうち今日が期限のものは独立したセクションに表示する
  const today = todos
    .filter((t) => !t.done && t.due && isToday(t.due))
    .sort(byDue);
  const active = todos
    .filter((t) => !t.done && !(t.due && isToday(t.due)))
    .sort(byDue);
  const done = todos.filter((t) => t.done).sort(byDue);

  for (const todo of today) todayList.appendChild(createItem(todo));
  for (const todo of active) activeList.appendChild(createItem(todo));
  for (const todo of done) doneList.appendChild(createItem(todo));

  todaySection.style.display = today.length === 0 ? "none" : "block";
  todayCount.textContent = today.length;
  activeEmpty.style.display = active.length === 0 ? "block" : "none";
  doneEmpty.style.display = done.length === 0 ? "block" : "none";
  activeCount.textContent = active.length;
  doneCount.textContent = done.length;

  const remaining = today.length + active.length;
  countEl.textContent =
    todos.length === 0 ? "" : `残り ${remaining} 件 / 全 ${todos.length} 件`;
}

function addTodo(text, due) {
  todos.push({ id: uid(), text, done: false, due: due || null, updatedAt: Date.now() });
  save();
  render();
  scheduleSync();
}

function toggle(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) {
    todo.done = !todo.done;
    todo.updatedAt = Date.now();
    save();
    render();
    scheduleSync();
  }
}

function remove(id) {
  todos = todos.filter((t) => t.id !== id);
  tombstones[id] = Date.now();
  save();
  render();
  scheduleSync();
}

function clearDone() {
  const now = Date.now();
  for (const t of todos) if (t.done) tombstones[t.id] = now;
  todos = todos.filter((t) => !t.done);
  save();
  render();
  scheduleSync();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addTodo(text, dateInput.value);
  input.value = "";
  dateInput.value = "";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearDone);

// Drive 同期モジュール用のインターフェース
window.TodoApp = {
  getState: () => ({
    todos: todos.map((t) => ({ ...t })),
    tombstones: { ...tombstones },
  }),
  setState: (doc) => {
    todos = (doc.todos || []).map(normalize);
    tombstones = doc.tombstones || {};
    save();
    render();
  },
};

render();
