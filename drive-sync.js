// Google Drive 自動同期
// データはあなたの Drive の「アプリ専用の隠しフォルダ(appDataFolder)」に
// todos.json として保存される。Drive の通常のファイル一覧には現れない。
(function () {
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const FILE_NAME = "todos.json";
  const AUTO_KEY = "simple-todo-drive-auto";

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let connected = false;
  let syncTimer = null;
  let busy = false;

  const els = {};

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function updateButtons() {
    if (!els.connect) return;
    els.connect.classList.toggle("hidden", connected);
    els.now.classList.toggle("hidden", !connected);
    els.disconnect.classList.toggle("hidden", !connected);
  }

  function waitForGoogle() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const iv = setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) {
          clearInterval(iv);
          resolve();
        } else if (++tries > 100) {
          clearInterval(iv);
          reject(new Error("gsi-timeout"));
        }
      }, 100);
    });
  }

  async function init() {
    els.connect = document.getElementById("sync-connect");
    els.now = document.getElementById("sync-now");
    els.disconnect = document.getElementById("sync-disconnect");
    els.status = document.getElementById("sync-status");

    els.connect.addEventListener("click", () => sync(true));
    els.now.addEventListener("click", () => sync(true));
    els.disconnect.addEventListener("click", disconnect);

    if (!window.GOOGLE_CLIENT_ID) {
      setStatus("同期は未設定（config.js に ID を入力）");
      els.connect.disabled = true;
      return;
    }

    try {
      await waitForGoogle();
    } catch {
      setStatus("Google の読み込みに失敗（オフライン？）");
      return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: () => {},
    });

    updateButtons();
    setStatus("未接続");

    // 以前接続していた端末なら、起動時に自動で同期を試みる
    if (localStorage.getItem(AUTO_KEY) === "1") sync(false);
  }

  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      if (accessToken && Date.now() < tokenExpiry - 60000) {
        return resolve(accessToken);
      }
      if (!tokenClient) return reject(new Error("no-client"));
      tokenClient.callback = (resp) => {
        if (resp && resp.error) return reject(resp);
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
        resolve(accessToken);
      };
      try {
        // interactive: 必要なら同意画面 / silent: 'none' で無音取得
        tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function api(url, opts, token) {
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) },
    });
    if (!res.ok) throw new Error("drive " + res.status);
    return res;
  }

  async function findFile(token) {
    const url =
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" +
      encodeURIComponent("name='" + FILE_NAME + "' and trashed=false") +
      "&fields=files(id)";
    const res = await api(url, {}, token);
    const data = await res.json();
    return data.files && data.files[0] ? data.files[0].id : null;
  }

  async function download(token, id) {
    const res = await api(
      "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
      {},
      token
    );
    return res.json();
  }

  async function upload(token, id, content) {
    const body = JSON.stringify(content);
    if (id) {
      await api(
        "https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body },
        token
      );
      return id;
    }
    const boundary = "todoboundary" + Date.now();
    const metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
    const multipart =
      "--" + boundary + "\r\n" +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) + "\r\n" +
      "--" + boundary + "\r\n" +
      "Content-Type: application/json\r\n\r\n" +
      body + "\r\n" +
      "--" + boundary + "--";
    const res = await api(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: { "Content-Type": "multipart/related; boundary=" + boundary },
        body: multipart,
      },
      token
    );
    const data = await res.json();
    return data.id;
  }

  // ローカルとリモートを id 単位でマージ（更新が新しい方を採用、削除も反映）
  function mergeDocs(a, b) {
    const tombstones = { ...(a.tombstones || {}) };
    for (const [id, t] of Object.entries(b.tombstones || {})) {
      if (!tombstones[id] || t > tombstones[id]) tombstones[id] = t;
    }
    const byId = new Map();
    for (const t of [...(a.todos || []), ...(b.todos || [])]) {
      const ex = byId.get(t.id);
      if (!ex || (t.updatedAt || 0) > (ex.updatedAt || 0)) byId.set(t.id, t);
    }
    const todos = [];
    for (const t of byId.values()) {
      const del = tombstones[t.id];
      if (del && del >= (t.updatedAt || 0)) continue; // 更新後に削除されたものは除外
      todos.push(t);
    }
    return { todos, tombstones };
  }

  function nowLabel() {
    return new Date().toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function sync(interactive) {
    if (busy) return;
    busy = true;
    try {
      const token = await getToken(interactive);
      setStatus("同期中…");
      const fileId = await findFile(token);
      let remote = { todos: [], tombstones: {} };
      if (fileId) {
        try {
          remote = await download(token, fileId);
        } catch {
          /* 空ファイル等は無視 */
        }
      }
      const local = window.TodoApp.getState();
      const merged = mergeDocs(local, remote);
      window.TodoApp.setState(merged);
      await upload(token, fileId, merged);
      connected = true;
      localStorage.setItem(AUTO_KEY, "1");
      updateButtons();
      setStatus("✅ 同期済み " + nowLabel());
    } catch (e) {
      if (interactive) {
        setStatus("⚠️ 同期に失敗しました");
        console.warn("sync error", e);
      } else {
        setStatus("未接続（同期するにはタップ）");
      }
    } finally {
      busy = false;
    }
  }

  function scheduleSync() {
    if (!connected) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync(false), 1500);
  }

  function disconnect() {
    if (accessToken && window.google) {
      try {
        google.accounts.oauth2.revoke(accessToken, () => {});
      } catch {
        /* noop */
      }
    }
    accessToken = null;
    tokenExpiry = 0;
    connected = false;
    localStorage.removeItem(AUTO_KEY);
    updateButtons();
    setStatus("切断しました");
  }

  window.DriveSync = { scheduleSync, sync };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
