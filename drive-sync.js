// Google Drive 自動同期
// データはあなたの Drive の「アプリ専用の隠しフォルダ(appDataFolder)」に
// todos.json として保存される。Drive の通常のファイル一覧には現れない。
(function () {
  const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  const FILE_NAME = "todos.json";
  const AUTO_KEY = "simple-todo-drive-auto"; // この端末で同期を有効にしたか
  const PENDING_KEY = "simple-todo-drive-pending"; // 未送信のローカル変更があるか

  const POLL_MS = 60 * 1000; // 定期的に相手端末の変更を取りに行く間隔
  const MIN_INTERVAL_MS = 5000; // 連続同期の最短間隔（イベントの重複発火よけ）
  const SILENT_RETRY_MS = 5 * 60 * 1000; // 無音ログイン失敗後、再試行するまで
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 削除記録の保持期間

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let enabled = localStorage.getItem(AUTO_KEY) === "1"; // 同期を使う設定
  let needsLogin = false; // 無音でトークンが取れず、手動ログインが要る状態
  let lastSilentFail = 0;
  let lastSyncAt = 0;
  let busy = false;
  let rerun = false; // 同期中に来た変更を取りこぼさないためのフラグ
  let debounceTimer = null;
  let pollTimer = null;
  // 進行中のトークン取得の resolve/reject（成功・失敗どちらでも必ず解決させる）
  let authResolve = null;
  let authReject = null;

  function settleAuth(ok, value) {
    const resolve = authResolve;
    const reject = authReject;
    authResolve = null;
    authReject = null;
    if (ok && resolve) resolve(value);
    if (!ok && reject) reject(value);
  }

  const els = {};

  function isPending() {
    return localStorage.getItem(PENDING_KEY) === "1";
  }

  function setPending(v) {
    if (v) localStorage.setItem(PENDING_KEY, "1");
    else localStorage.removeItem(PENDING_KEY);
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text;
  }

  function updateButtons() {
    if (!els.connect) return;
    // 未設定の端末と、再ログインが必要な端末では接続ボタンを出す
    const showConnect = !enabled || needsLogin;
    els.connect.textContent = needsLogin
      ? "🔑 再ログイン"
      : "🔗 Google Drive と同期";
    els.connect.classList.toggle("hidden", !showConnect);
    els.now.classList.toggle("hidden", !enabled);
    els.disconnect.classList.toggle("hidden", !enabled);
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

    updateButtons();
    setStatus(enabled ? "同期の準備中…" : "未接続");

    try {
      await waitForGoogle();
    } catch {
      setStatus("Google の読み込みに失敗（オフライン？）");
      return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp && resp.error) {
          settleAuth(false, resp);
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
        settleAuth(true, accessToken);
      },
      // ポップアップが閉じられた/ブロックされた等はこちらに来る
      error_callback: (err) => {
        settleAuth(false, err || { type: "popup_error" });
      },
    });

    registerTriggers();

    // 以前接続していた端末なら、起動時に自動で同期を試みる
    if (enabled) sync(false);
  }

  // 相手端末の変更を取りに行くきっかけ。
  // 「自分が編集したとき」だけだと片方向にしか流れないので、
  // 画面に戻ったとき・オンライン復帰時・一定時間ごとにも引きに行く。
  function registerTriggers() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sync(false);
    });
    window.addEventListener("focus", () => sync(false));
    window.addEventListener("online", () => sync(false));
    window.addEventListener("pageshow", () => sync(false));

    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      // 非表示のタブ／バックグラウンドのアプリでは通信しない
      if (document.visibilityState === "visible") sync(false);
    }, POLL_MS);
  }

  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      if (accessToken && Date.now() < tokenExpiry - 60000) {
        return resolve(accessToken);
      }
      if (!tokenClient) return reject(new Error("no-client"));

      // 万一どのコールバックも呼ばれなくても固まらないよう保険のタイムアウト
      const watchdog = setTimeout(
        () => settleAuth(false, { type: "timeout" }),
        interactive ? 90000 : 15000
      );

      authResolve = (token) => {
        clearTimeout(watchdog);
        resolve(token);
      };
      authReject = (err) => {
        clearTimeout(watchdog);
        reject(err);
      };

      try {
        // interactive: 必要なら同意画面 / silent: 'none' で無音取得
        tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
      } catch (e) {
        settleAuth(false, e);
      }
    });
  }

  async function api(url, opts, token) {
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: "Bearer " + token, ...(opts && opts.headers) },
    });
    if (!res.ok) {
      let msg = "";
      try {
        const body = await res.json();
        msg = (body.error && (body.error.message || body.error.status)) || "";
      } catch {
        /* noop */
      }
      const err = new Error("Drive " + res.status + (msg ? " " + msg : ""));
      err.status = res.status;
      throw err;
    }
    return res;
  }

  // 同名ファイルは複数存在しうる（両端末が同時に初回接続した場合など）。
  // すべて拾って作成順に並べ、いちばん古いものを正とする。
  async function findFiles(token) {
    const url =
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" +
      encodeURIComponent("name='" + FILE_NAME + "' and trashed=false") +
      "&orderBy=createdTime&fields=files(id,createdTime)";
    const res = await api(url, {}, token);
    const data = await res.json();
    return (data.files || []).map((f) => f.id);
  }

  async function download(token, id) {
    const res = await api(
      "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media",
      {},
      token
    );
    return res.json();
  }

  async function deleteFile(token, id) {
    await api(
      "https://www.googleapis.com/drive/v3/files/" + id,
      { method: "DELETE" },
      token
    );
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

  // 古すぎる削除記録は捨てる（際限なく溜まるのを防ぐ）
  function pruneTombstones(tombstones) {
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const out = {};
    for (const [id, t] of Object.entries(tombstones)) {
      if (t > cutoff) out[id] = t;
    }
    return out;
  }

  // 2つのリストを id 単位でマージ（更新が新しい方を採用、削除も反映）
  function mergeList(listA, listB, tombstones) {
    const byId = new Map();
    for (const t of [...(listA || []), ...(listB || [])]) {
      if (!t || !t.id) continue;
      const ex = byId.get(t.id);
      if (!ex || (t.updatedAt || 0) > (ex.updatedAt || 0)) byId.set(t.id, t);
    }
    const out = [];
    for (const t of byId.values()) {
      const del = tombstones[t.id];
      if (del && del >= (t.updatedAt || 0)) continue; // 更新後に削除されたものは除外
      out.push(t);
    }
    return out;
  }

  // ローカルとリモートをマージする。タスクとフォルダは同じ tombstones を共有する
  function mergeDocs(a, b) {
    const tombstones = { ...(a.tombstones || {}) };
    for (const [id, t] of Object.entries(b.tombstones || {})) {
      if (!tombstones[id] || t > tombstones[id]) tombstones[id] = t;
    }
    const todos = mergeList(a.todos, b.todos, tombstones);
    const folders = mergeList(a.folders, b.folders, tombstones);

    // 消えたフォルダを指すタスクは、フォルダなしに戻して救済する
    const ids = new Set(folders.map((f) => f.id));
    for (const t of todos) {
      if (t.folderId && !ids.has(t.folderId)) t.folderId = null;
    }

    return { todos, folders, tombstones: pruneTombstones(tombstones) };
  }

  function nowLabel() {
    return new Date().toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function sync(interactive) {
    if (busy) {
      rerun = true;
      return;
    }
    if (!interactive) {
      if (!enabled || !tokenClient) return;
      if (!navigator.onLine) {
        setStatus("📴 オフライン（未送信の変更は保持）");
        return;
      }
      // 無音ログインに失敗した直後は連打しない（ユーザーのタップを待つ）
      if (needsLogin && Date.now() - lastSilentFail < SILENT_RETRY_MS) return;
      // 未送信の変更がなければ、短時間の重複発火は無視する
      if (Date.now() - lastSyncAt < MIN_INTERVAL_MS && !isPending()) return;
    }

    busy = true;
    try {
      let token;
      try {
        setStatus(interactive ? "ログイン中…" : "同期中…");
        token = await getToken(interactive);
        needsLogin = false;
      } catch (e) {
        // 認可が取れない ＝ 通信の失敗ではなくログインの問題として扱う
        console.warn("auth error", e);
        needsLogin = true;
        lastSilentFail = Date.now();
        setStatus(
          interactive
            ? "⚠️ ログインできませんでした"
            : "🔑 再ログインが必要です（タップ）"
        );
        return;
      }

      setStatus("同期中…");
      const ids = await findFiles(token);

      let remote = { todos: [], folders: [], tombstones: {} };
      for (const id of ids) {
        try {
          remote = mergeDocs(remote, await download(token, id));
        } catch (e) {
          console.warn("skip file", id, e); // 空・壊れたファイルは無視
        }
      }

      const merged = mergeDocs(window.TodoApp.getState(), remote);
      window.TodoApp.setState(merged);

      const primary = ids[0] || null;
      await upload(token, primary, merged);
      // 重複してできたファイルは正のファイルに統合したうえで削除する
      for (const id of ids.slice(1)) {
        try {
          await deleteFile(token, id);
        } catch (e) {
          console.warn("duplicate cleanup failed", id, e);
        }
      }

      enabled = true;
      localStorage.setItem(AUTO_KEY, "1");
      setPending(false);
      setStatus("✅ 同期済み " + nowLabel());
    } catch (e) {
      console.warn("sync error", e);
      if (e && (e.status === 401 || e.status === 403)) {
        // トークンが失効している。次回は取り直す
        accessToken = null;
        tokenExpiry = 0;
        needsLogin = true;
        lastSilentFail = Date.now();
        setStatus("🔑 再ログインが必要です（タップ）");
      } else {
        const detail =
          (e && (e.message || e.error || e.type || e.error_description)) || "不明";
        setStatus("⚠️ 同期に失敗: " + detail + "（変更は保持）");
      }
    } finally {
      busy = false;
      // 成功・失敗にかかわらず記録し、イベントの重複発火で連打するのを防ぐ
      lastSyncAt = Date.now();
      updateButtons();
      if (rerun) {
        rerun = false;
        setTimeout(() => sync(false), 300);
      }
    }
  }

  function scheduleSync() {
    // 送信できたかに関わらず「未送信の変更あり」を必ず記録しておく。
    // これでログイン切れ・オフラインをまたいでも取りこぼさない。
    setPending(true);
    if (!enabled) return;
    if (!busy) setStatus("⏳ 未送信の変更あり");
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => sync(false), 1200);
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
    enabled = false;
    needsLogin = false;
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
