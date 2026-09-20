const $ = function (s) { return document.querySelector(s); };
const isTab = /[?&]tab=1/.test(location.search);
if (isTab) {
  document.body.classList.add("tab");
  $("#open-tab").hidden = true;
}

let records = [];
let query = "";
let filter = "all";
const expanded = new Set();
const thinkOpen = new Set();

/* ---------- helpers ---------- */

function norm(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function textOf(rec, type) {
  return rec.fragments
    .filter(function (f) { return f.type === type; })
    .map(function (f) { return f.content; })
    .join("");
}
function answerOf(rec) { return textOf(rec, "RESPONSE"); }
function thinkOf(rec) { return textOf(rec, "THINK"); }
function promptOf(rec) { return rec.prompt || ""; }

function formatWhen(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return "Today, " + hm;
  if (diff === 1) return "Yesterday, " + hm;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + hm;
}

function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

function slug(s) {
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "conversation";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, cls, onClick) {
  const b = el("button", cls, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", function () { onClick(b); });
  return b;
}

// Button that asks for a second click before confirming (avoids accidental deletes)
function armable(b, label, onConfirm) {
  let timer = null;
  b.addEventListener("click", function () {
    if (b.dataset.armed) {
      clearTimeout(timer);
      delete b.dataset.armed;
      b.classList.remove("armed");
      b.textContent = label;
      onConfirm();
      return;
    }
    b.dataset.armed = "1";
    b.classList.add("armed");
    b.textContent = "Click again to delete";
    timer = setTimeout(function () {
      delete b.dataset.armed;
      b.classList.remove("armed");
      b.textContent = label;
    }, 3000);
  });
  return b;
}

async function copy(btn, text) {
  const old = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied ✓";
  } catch (e) {
    btn.textContent = "Couldn't copy";
  }
  setTimeout(function () { btn.textContent = old; }, 1300);
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

/* ---------- exported text ---------- */

function messageMd(rec) {
  let md = "";
  if (promptOf(rec)) md += "### You\n\n" + promptOf(rec) + "\n\n";
  const think = thinkOf(rec);
  md += "### DeepSeek\n\n" + answerOf(rec) + "\n";
  if (think) md += "\n<details><summary>Reasoning</summary>\n\n" + think + "\n\n</details>\n";
  return md;
}

function groupMd(g) {
  let md = "# " + g.title + "\n\n";
  g.recs.forEach(function (r) {
    md += "_" + new Date(r.startedAt).toLocaleString("en-US") + "_\n\n" + messageMd(r) + "\n---\n\n";
  });
  return md;
}

/* ---------- grouping and filtering ---------- */

function buildGroups(list) {
  const map = new Map();
  list.forEach(function (r) {
    const key = r.sessionId || r.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  const groups = [];
  map.forEach(function (recs, key) {
    recs.sort(function (a, b) { return a.startedAt - b.startedAt; });
    let title = "";
    recs.forEach(function (r) { if (!title && r.title) title = r.title; });
    if (!title) {
      const p = promptOf(recs[0]).replace(/\s+/g, " ").trim();
      title = p ? (p.length > 60 ? p.slice(0, 60) + "…" : p) : "Untitled conversation";
    }
    groups.push({
      key: key,
      recs: recs,
      title: title,
      updatedAt: Math.max.apply(null, recs.map(function (r) { return r.updatedAt || r.startedAt; })),
    });
  });
  groups.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  return groups;
}

/* ---------- rendering ---------- */

function messageCard(rec) {
  const answer = answerOf(rec);
  const prompt = promptOf(rec);
  const think = thinkOf(rec);
  const isOpen = expanded.has(rec.id);
  const isLong = function (t) { return t.length > 320 || t.split("\n").length > 5; };
  const long = isLong(answer) || isLong(prompt);

  const card = el("article", "msg" + (rec.flagged ? " flagged" : "") + (long && !isOpen ? " clamp" : ""));

  if (prompt) {
    const q = el("div", "q");
    q.appendChild(el("div", "who", "You"));
    q.appendChild(el("p", "text", prompt));
    card.appendChild(q);
  }

  const a = el("div", "a");
  const head = el("div", "a-head");
  head.appendChild(el("span", "who ai", "DeepSeek"));
  if (!rec.done) head.appendChild(el("span", "live", "still typing…"));
  head.appendChild(el("span", "time", formatWhen(rec.startedAt)));
  a.appendChild(head);

  if (answer) {
    a.appendChild(el("p", "text", answer));
  } else {
    a.appendChild(el("p", "text placeholder", rec.done ? "No reply text here." : "Thinking…"));
  }

  if (long) {
    const more = button(isOpen ? "Show less" : "Show all", "more", function () {
      if (expanded.has(rec.id)) expanded.delete(rec.id); else expanded.add(rec.id);
      render();
    });
    a.appendChild(more);
  }

  if (rec.flagged) {
    a.appendChild(el("div", "notice", "Looks like the site trimmed this reply from the screen — no worries, the full text is safe right here."));
  }

  if (think) {
    const d = el("details", "think");
    d.open = thinkOpen.has(rec.id);
    d.addEventListener("toggle", function () {
      if (d.open) thinkOpen.add(rec.id); else thinkOpen.delete(rec.id);
    });
    d.appendChild(el("summary", null, "Show reasoning"));
    d.appendChild(el("div", "think-body", think));
    a.appendChild(d);
  }
  card.appendChild(a);

  const actions = el("div", "actions");
  actions.appendChild(button("Copy reply", "btn primary", function (b) { copy(b, answer); }));
  if (prompt) {
    actions.appendChild(button("Copy all", "btn", function (b) {
      copy(b, "You:\n" + prompt + "\n\nDeepSeek:\n" + answer);
    }));
  }
  actions.appendChild(button("Download .md", "btn", function () {
    download(slug(prompt || rec.title) + "-" + rec.startedAt + ".md", messageMd(rec));
  }));
  actions.appendChild(button("Technical log", "btn quiet", function (b) {
    copy(b, JSON.stringify({
      status: rec.status, flagged: rec.flagged, notes: rec.notes,
      request_fields: rec.reqKeys || null,
      prompt_captured: !!prompt, last_lines: rec.tail,
    }, null, 2));
  }));
  const del = button("Delete", "btn danger");
  armable(del, "Delete", function () {
    browser.runtime.sendMessage({ cmd: "delete", id: rec.id });
  });
  actions.appendChild(del);
  card.appendChild(actions);

  return card;
}

function emptyState(title, text) {
  const d = el("div", "empty");
  d.appendChild(el("strong", null, title));
  d.appendChild(document.createTextNode(text));
  return d;
}

function render() {
  const sc = $("#scroll");
  const y = sc.scrollTop;
  const list = $("#list");
  list.textContent = "";

  const valid = records.filter(function (r) { return r.fragments && r.fragments.length; });
  $("#n-all").textContent = valid.length;
  $("#n-flagged").textContent = valid.filter(function (r) { return r.flagged; }).length;
  document.querySelectorAll(".chip").forEach(function (c) {
    c.setAttribute("aria-pressed", String(c.dataset.f === filter));
  });

  if (!valid.length) {
    list.appendChild(emptyState(
      "Nothing saved yet",
      "Once you chat on chat.deepseek.com, replies will show up here automatically — even the ones the site later deletes."
    ));
    return;
  }

  let shown = 0;
  buildGroups(valid).forEach(function (g) {
    const titleHit = query && norm(g.title).indexOf(query) !== -1;
    const msgs = g.recs.filter(function (r) {
      if (filter === "flagged" && !r.flagged) return false;
      if (!query || titleHit) return true;
      return norm(promptOf(r) + " " + answerOf(r)).indexOf(query) !== -1;
    });
    if (!msgs.length) return;
    shown += msgs.length;

    const group = el("section", "group");
    const head = el("div", "g-head");
    head.appendChild(el("h2", "g-title", g.title));
    const side = el("div", "g-side");
    side.appendChild(document.createTextNode(plural(msgs.length, "message", "messages") + " · " + formatWhen(g.updatedAt)));
    side.appendChild(button("Download", "btn quiet", function () {
      download(slug(g.title) + ".md", groupMd({ title: g.title, recs: msgs }));
    }));
    head.appendChild(side);
    group.appendChild(head);
    msgs.forEach(function (r) { group.appendChild(messageCard(r)); });
    list.appendChild(group);
  });

  if (!shown) {
    list.appendChild(emptyState(
      query ? "No matches" : "No flagged replies",
      query ? "Try a different word from the question or the reply." : "If the site ever filters a reply, you'll find it here."
    ));
  }
  sc.scrollTop = y;
}

/* ---------- events ---------- */

$("#q").addEventListener("input", function (e) {
  query = norm(e.target.value.trim());
  render();
});

document.querySelectorAll(".chip").forEach(function (c) {
  c.addEventListener("click", function () {
    filter = c.dataset.f;
    render();
  });
});

$("#open-tab").addEventListener("click", function () {
  browser.tabs.create({ url: browser.runtime.getURL("popup.html?tab=1") });
  window.close();
});

$("#export-all").addEventListener("click", function () {
  const valid = records.filter(function (r) { return r.fragments && r.fragments.length; });
  if (!valid.length) return;
  const md = buildGroups(valid).map(groupMd).join("\n");
  download("deepseek-saver-" + new Date().toISOString().slice(0, 10) + ".md", md);
});

armable($("#clear"), "Delete all", function () {
  browser.runtime.sendMessage({ cmd: "clear" });
});

async function load() {
  const r = await browser.storage.local.get("records");
  records = r.records || [];
  render();
}

browser.storage.onChanged.addListener(function (changes) {
  if (changes.records) load();
});
load();
