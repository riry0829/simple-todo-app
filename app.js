// シンプルな ToDo リスト — localStorage で保存
const STORAGE_KEY = "simple-todo-app";

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const dateInput = document.getElementById("todo-date");
const activeList = document.getElementById("active-list");
const doneList = document.getElementById("done-list");
const activeEmpty = document.getElementById("active-empty");
const doneEmpty = document.getElementById("done-empty");
const activeCount = document.getElementById("active-count");
const doneCount = document.getElementById("done-count");
const countEl = document.getElementById("count");
const clearDoneBtn = document.getElementById("clear-done");

/** @type {{id: number, text: string, done: boolean, due: string|null}[]} */
let todos = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
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

function isOverdue(due) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(due + "T00:00:00") < today;
}

function render() {
  activeList.innerHTML = "";
  doneList.innerHTML = "";

  const active = todos.filter((t) => !t.done).sort(byDue);
  const done = todos.filter((t) => t.done).sort(byDue);

  for (const todo of active) activeList.appendChild(createItem(todo));
  for (const todo of done) doneList.appendChild(createItem(todo));

  activeEmpty.style.display = active.length === 0 ? "block" : "none";
  doneEmpty.style.display = done.length === 0 ? "block" : "none";
  activeCount.textContent = active.length;
  doneCount.textContent = done.length;

  countEl.textContent =
    todos.length === 0 ? "" : `残り ${active.length} 件 / 全 ${todos.length} 件`;
}

function addTodo(text, due) {
  todos.push({ id: Date.now(), text, done: false, due: due || null });
  save();
  render();
}

function toggle(id) {
  const todo = todos.find((t) => t.id === id);
  if (todo) {
    todo.done = !todo.done;
    save();
    render();
  }
}

function remove(id) {
  todos = todos.filter((t) => t.id !== id);
  save();
  render();
}

function clearDone() {
  todos = todos.filter((t) => !t.done);
  save();
  render();
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

render();
