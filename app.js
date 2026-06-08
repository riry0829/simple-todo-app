// シンプルな ToDo リスト — localStorage で保存
const STORAGE_KEY = "simple-todo-app";

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const activeList = document.getElementById("active-list");
const doneList = document.getElementById("done-list");
const activeEmpty = document.getElementById("active-empty");
const doneEmpty = document.getElementById("done-empty");
const activeCount = document.getElementById("active-count");
const doneCount = document.getElementById("done-count");
const countEl = document.getElementById("count");
const clearDoneBtn = document.getElementById("clear-done");

/** @type {{id: number, text: string, done: boolean}[]} */
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

  const span = document.createElement("span");
  span.className = "todo-text";
  span.textContent = todo.text;

  const delBtn = document.createElement("button");
  delBtn.className = "delete-btn";
  delBtn.textContent = "✕";
  delBtn.setAttribute("aria-label", "削除");
  delBtn.addEventListener("click", () => remove(todo.id));

  li.append(checkbox, span, delBtn);
  return li;
}

function render() {
  activeList.innerHTML = "";
  doneList.innerHTML = "";

  const active = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  for (const todo of active) activeList.appendChild(createItem(todo));
  for (const todo of done) doneList.appendChild(createItem(todo));

  activeEmpty.style.display = active.length === 0 ? "block" : "none";
  doneEmpty.style.display = done.length === 0 ? "block" : "none";
  activeCount.textContent = active.length;
  doneCount.textContent = done.length;

  countEl.textContent =
    todos.length === 0 ? "" : `残り ${active.length} 件 / 全 ${todos.length} 件`;
}

function addTodo(text) {
  todos.push({ id: Date.now(), text, done: false });
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
  addTodo(text);
  input.value = "";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearDone);

render();
