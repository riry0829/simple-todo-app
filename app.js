// シンプルな ToDo リスト — localStorage で保存
const STORAGE_KEY = "simple-todo-app";
// 折りたたみ状態は端末ごとの見た目の話なので、同期せず端末内だけに持つ
const COLLAPSE_KEY = "simple-todo-collapsed";

const form = document.getElementById("todo-form");
const input = document.getElementById("todo-input");
const dateInput = document.getElementById("todo-date");
const todaySection = document.getElementById("today-section");
const todayFolders = document.getElementById("today-folders");
const todayList = document.getElementById("today-list");
const todayCount = document.getElementById("today-count");
const activeFolders = document.getElementById("active-folders");
const activeList = document.getElementById("active-list");
const doneList = document.getElementById("done-list");
const activeEmpty = document.getElementById("active-empty");
const doneEmpty = document.getElementById("done-empty");
const activeCount = document.getElementById("active-count");
const doneCount = document.getElementById("done-count");
const countEl = document.getElementById("count");
const clearDoneBtn = document.getElementById("clear-done");

const folderNewBtn = document.getElementById("folder-new-btn");
const folderPanel = document.getElementById("folder-panel");
const folderPanelTitle = document.getElementById("folder-panel-title");
const folderMeta = document.getElementById("folder-meta");
const folderNameInput = document.getElementById("folder-name");
const folderDueInput = document.getElementById("folder-due");
const folderItemsInput = document.getElementById("folder-items");
const folderSaveBtn = document.getElementById("folder-save");
const folderCancelBtn = document.getElementById("folder-cancel");

/** @type {{id: string, text: string, done: boolean, due: string|null, folderId: string|null, updatedAt: number}[]} */
let todos = [];
/** @type {{id: string, name: string, due: string|null, updatedAt: number}[]} */
let folders = [];
/** 削除済みタスク／フォルダの記録（同期で削除を反映するため）: { [id]: 削除時刻 } */
let tombstones = {};
/** 折りたたみ中のフォルダ id */
let collapsed = new Set();

loadState();
loadCollapsed();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalize(t) {
  // updatedAt は同期のマージで新旧を比較する値なので、必ず数値にしておく。
  // （id は文字列なので、代わりに入れると比較が壊れる）
  const updatedAt = Number(t.updatedAt);
  return {
    id: t.id || uid(),
    text: t.text,
    done: !!t.done,
    due: t.due || null,
    folderId: t.folderId || null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function normalizeFolder(f) {
  const updatedAt = Number(f.updatedAt);
  return {
    id: f.id || uid(),
    name: f.name || "(名称未設定)",
    due: f.due || null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(raw)) {
      // 旧フォーマット（配列）からの移行。updatedAt を持たないので現在時刻を打つ
      const now = Date.now();
      todos = raw.map((t) => normalize({ ...t, updatedAt: t.updatedAt || now }));
      folders = [];
      tombstones = {};
      save();
    } else if (raw && Array.isArray(raw.todos)) {
      todos = raw.todos.map(normalize);
      folders = (raw.folders || []).map(normalizeFolder);
      tombstones = raw.tombstones || {};
    } else {
      todos = [];
      folders = [];
      tombstones = {};
    }
  } catch {
    todos = [];
    folders = [];
    tombstones = {};
  }
  dropOrphans();
}

// 存在しないフォルダを指すタスクは、フォルダなしとして扱う（同期の行き違い対策）
function dropOrphans() {
  const ids = new Set(folders.map((f) => f.id));
  for (const t of todos) {
    if (t.folderId && !ids.has(t.folderId)) t.folderId = null;
  }
}

function save() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ todos, folders, tombstones })
  );
}

function loadCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY));
    collapsed = new Set(Array.isArray(raw) ? raw : []);
  } catch {
    collapsed = new Set();
  }
}

function saveCollapsed() {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
}

function scheduleSync() {
  if (window.DriveSync) window.DriveSync.scheduleSync();
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

function todayYmd() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(t.getDate()).padStart(2, "0")}`;
}

function isToday(due) {
  return due === todayYmd();
}

function isOverdue(due) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(due + "T00:00:00") < today;
}

function dueBadge(due, done) {
  const el = document.createElement("span");
  el.className = "todo-due";
  el.textContent = "📅 " + formatDue(due);
  if (!done && isOverdue(due)) el.classList.add("overdue");
  return el;
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

  if (todo.due) body.appendChild(dueBadge(todo.due, todo.done));

  const delBtn = document.createElement("button");
  delBtn.className = "delete-btn";
  delBtn.textContent = "✕";
  delBtn.setAttribute("aria-label", "削除");
  delBtn.addEventListener("click", () => remove(todo.id));

  li.append(checkbox, body, delBtn);
  return li;
}

function itemsOf(folderId) {
  return todos.filter((t) => t.folderId === folderId).sort(byDue);
}

function createFolderBlock(folder) {
  const items = itemsOf(folder.id);
  const doneN = items.filter((t) => t.done).length;
  const isCollapsed = collapsed.has(folder.id);

  const li = document.createElement("li");
  li.className = "folder" + (isCollapsed ? " collapsed" : "");

  const head = document.createElement("div");
  head.className = "folder-head";

  // 見出しの左側全体で開閉できるようにする（▼ は見た目の手がかり）
  const toggleBtn = document.createElement("span");
  toggleBtn.className = "folder-toggle";
  toggleBtn.textContent = isCollapsed ? "▶" : "▼";

  const name = document.createElement("span");
  name.className = "folder-name";
  name.textContent = "📁 " + folder.name;

  const openArea = document.createElement("button");
  openArea.className = "folder-open-area";
  openArea.setAttribute("aria-label", isCollapsed ? "展開する" : "折りたたむ");
  openArea.append(toggleBtn, name);
  if (folder.due) {
    openArea.appendChild(dueBadge(folder.due, items.length > 0 && doneN === items.length));
  }
  openArea.addEventListener("click", () => {
    if (collapsed.has(folder.id)) collapsed.delete(folder.id);
    else collapsed.add(folder.id);
    saveCollapsed();
    render();
  });

  const progress = document.createElement("span");
  progress.className = "folder-progress";
  if (items.length > 0 && doneN === items.length) {
    progress.classList.add("complete");
  }
  progress.textContent = doneN + "/" + items.length;

  const addBtn = document.createElement("button");
  addBtn.className = "folder-add-btn";
  addBtn.textContent = "＋";
  addBtn.title = "このフォルダに追加";
  addBtn.setAttribute("aria-label", "このフォルダに追加");
  addBtn.addEventListener("click", () => openPanel(folder.id));

  const delBtn = document.createElement("button");
  delBtn.className = "delete-btn";
  delBtn.textContent = "✕";
  delBtn.title = "フォルダを削除";
  delBtn.setAttribute("aria-label", "フォルダを削除");
  delBtn.addEventListener("click", () => removeFolder(folder.id));

  head.append(openArea, progress, addBtn, delBtn);
  li.appendChild(head);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-msg folder-empty";
    empty.textContent = "「＋」から項目を追加できます";
    li.appendChild(empty);
    return li;
  }

  const list = document.createElement("ul");
  list.className = "todo-list folder-items";
  for (const t of items) list.appendChild(createItem(t));
  li.appendChild(list);
  return li;
}

function render() {
  todayFolders.innerHTML = "";
  todayList.innerHTML = "";
  activeFolders.innerHTML = "";
  activeList.innerHTML = "";
  doneList.innerHTML = "";

  // 期限が今日のフォルダは「今日やること」へ、それ以外は「未完了」へ
  const sortedFolders = [...folders].sort(byDue);
  const todayFolderList = sortedFolders.filter((f) => f.due && isToday(f.due));
  const otherFolderList = sortedFolders.filter((f) => !(f.due && isToday(f.due)));

  // フォルダに属さないタスクだけが、今日／未完了／完了の3カラムに並ぶ
  const loose = todos.filter((t) => !t.folderId);
  const todayLoose = loose
    .filter((t) => !t.done && t.due && isToday(t.due))
    .sort(byDue);
  const activeLoose = loose
    .filter((t) => !t.done && !(t.due && isToday(t.due)))
    .sort(byDue);
  const doneLoose = loose.filter((t) => t.done).sort(byDue);

  for (const f of todayFolderList) todayFolders.appendChild(createFolderBlock(f));
  for (const t of todayLoose) todayList.appendChild(createItem(t));
  for (const f of otherFolderList) activeFolders.appendChild(createFolderBlock(f));
  for (const t of activeLoose) activeList.appendChild(createItem(t));
  for (const t of doneLoose) doneList.appendChild(createItem(t));

  // 件数はフォルダ内の未完了も含めて数える
  const undoneIn = (list) =>
    list.reduce((n, f) => n + itemsOf(f.id).filter((t) => !t.done).length, 0);
  const todayN = todayLoose.length + undoneIn(todayFolderList);
  const activeN = activeLoose.length + undoneIn(otherFolderList);

  todaySection.style.display =
    todayFolderList.length === 0 && todayLoose.length === 0 ? "none" : "block";
  todayCount.textContent = todayN;
  activeEmpty.style.display =
    otherFolderList.length === 0 && activeLoose.length === 0 ? "block" : "none";
  doneEmpty.style.display = doneLoose.length === 0 ? "block" : "none";
  activeCount.textContent = activeN;
  doneCount.textContent = doneLoose.length;

  const remaining = todos.filter((t) => !t.done).length;
  countEl.textContent =
    todos.length === 0 ? "" : `残り ${remaining} 件 / 全 ${todos.length} 件`;
}

function addTodo(text, due, folderId) {
  todos.push({
    id: uid(),
    text,
    done: false,
    due: due || null,
    folderId: folderId || null,
    updatedAt: Date.now(),
  });
}

// 複数行のテキストを1行1タスクとして取り込む（空行は無視）
function addLines(text, folderId) {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const line of lines) addTodo(line, null, folderId);
  return lines.length;
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

function removeFolder(id) {
  const folder = folders.find((f) => f.id === id);
  if (!folder) return;
  const items = itemsOf(id);
  const msg =
    items.length === 0
      ? `フォルダ「${folder.name}」を削除しますか？`
      : `フォルダ「${folder.name}」と、中の ${items.length} 件をすべて削除しますか？`;
  if (!confirm(msg)) return;

  const now = Date.now();
  for (const t of items) tombstones[t.id] = now;
  tombstones[id] = now;
  todos = todos.filter((t) => t.folderId !== id);
  folders = folders.filter((f) => f.id !== id);
  collapsed.delete(id);
  saveCollapsed();
  save();
  render();
  scheduleSync();
}

// 完了済みの削除は「完了」カラムに見えているもの（フォルダ外）だけを対象にする。
// フォルダ内の完了項目は、持ち物リストの記録として残したいので消さない。
function clearDone() {
  const now = Date.now();
  const target = todos.filter((t) => t.done && !t.folderId);
  if (target.length === 0) return;
  for (const t of target) tombstones[t.id] = now;
  todos = todos.filter((t) => !(t.done && !t.folderId));
  save();
  render();
  scheduleSync();
}

/* ---- フォルダ作成／項目追加パネル ---- */

// null = 新規フォルダ作成 / 文字列 = そのフォルダへ項目を追加
let panelTarget = null;

function openPanel(folderId) {
  panelTarget = folderId || null;
  const isNew = !folderId;
  folderPanel.classList.remove("hidden");
  folderMeta.classList.toggle("hidden", !isNew);
  folderNewBtn.classList.add("hidden");

  if (isNew) {
    folderPanelTitle.textContent = "新しいフォルダ";
    folderSaveBtn.textContent = "作成";
    folderNameInput.value = "";
    folderDueInput.value = "";
  } else {
    const folder = folders.find((f) => f.id === folderId);
    folderPanelTitle.textContent = `「${folder ? folder.name : ""}」に追加`;
    folderSaveBtn.textContent = "追加";
  }
  folderItemsInput.value = "";
  folderPanel.scrollIntoView({ block: "nearest" });
  (isNew ? folderNameInput : folderItemsInput).focus();
}

function closePanel() {
  panelTarget = null;
  folderPanel.classList.add("hidden");
  folderNewBtn.classList.remove("hidden");
  folderNameInput.value = "";
  folderDueInput.value = "";
  folderItemsInput.value = "";
}

function submitPanel() {
  if (panelTarget) {
    const n = addLines(folderItemsInput.value, panelTarget);
    if (n === 0) {
      folderItemsInput.focus();
      return;
    }
    collapsed.delete(panelTarget);
    saveCollapsed();
  } else {
    const name = folderNameInput.value.trim();
    if (!name) {
      folderNameInput.focus();
      return;
    }
    const folder = {
      id: uid(),
      name,
      due: folderDueInput.value || null,
      updatedAt: Date.now(),
    };
    folders.push(folder);
    addLines(folderItemsInput.value, folder.id);
  }
  save();
  render();
  scheduleSync();
  closePanel();
}

folderNewBtn.addEventListener("click", () => openPanel(null));
folderCancelBtn.addEventListener("click", closePanel);
folderSaveBtn.addEventListener("click", submitPanel);
// 改行が項目の区切りなので、確定は Ctrl+Enter（スマホは「作成」ボタン）
folderItemsInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitPanel();
});
folderNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    folderItemsInput.focus();
  }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addTodo(text, dateInput.value, null);
  save();
  render();
  scheduleSync();
  input.value = "";
  dateInput.value = "";
  input.focus();
});

clearDoneBtn.addEventListener("click", clearDone);

// Drive 同期モジュール用のインターフェース
window.TodoApp = {
  getState: () => ({
    todos: todos.map((t) => ({ ...t })),
    folders: folders.map((f) => ({ ...f })),
    tombstones: { ...tombstones },
  }),
  setState: (doc) => {
    todos = (doc.todos || []).map(normalize);
    folders = (doc.folders || []).map(normalizeFolder);
    tombstones = doc.tombstones || {};
    dropOrphans();
    save();
    render();
  },
};

render();
