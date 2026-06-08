// シンプルな ToDo リスト — localStorage で保存
const STORAGE_KEY = "simple-todo-app";

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const list = document.getElementById("todo-list");
const emptyMsg = document.getElementById("empty-msg");
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

function render() {
  list.innerHTML = "";

  for (const todo of todos) {
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
    list.appendChild(li);
  }

  const remaining = todos.filter((t) => !t.done).length;
  emptyMsg.style.display = todos.length === 0 ? "block" : "none";
  countEl.textContent =
    todos.length === 0 ? "" : `残り ${remaining} 件 / 全 ${todos.length} 件`;
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
