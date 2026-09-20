// Reads the DeepSeek reply straight from the network (webRequest.filterResponseData),
// before the page processes it. Whatever the site does afterwards on screen
// (deleting, replacing with a notice) does not affect what is already saved here.

const URL_FILTER = { urls: ["https://chat.deepseek.com/api/v0/chat/*"] };
const MATCH = /\/api\/v0\/chat\/(completion|regenerate|continue|resume)/;
const MAX_RECORDS = 300;

const records = new Map();
const loaded = browser.storage.local.get("records").then(function (r) {
  (r.records || []).forEach(function (rec) {
    if (!records.has(rec.id)) records.set(rec.id, rec);
  });
});


// Reads the question and the conversation id from the request body (JSON).
function readRequest(details) {
  const out = {};
  try {
    const raw = details.requestBody && details.requestBody.raw;
    if (!raw || !raw.length) return out;
    const dec = new TextDecoder("utf-8");
    let text = "";
    raw.forEach(function (part) {
      if (part.bytes) text += dec.decode(part.bytes, { stream: true });
    });
    text += dec.decode();
    const d = JSON.parse(text);
    out.keys = Object.keys(d);
    out.sessionId = d.chat_session_id || d.session_id || d.conversation_id || null;
    if (typeof d.prompt === "string") {
      out.prompt = d.prompt;
    } else {
      // Fallback: the longest text value that does not look like an id
      let best = "";
      Object.keys(d).forEach(function (k) {
        if (typeof d[k] === "string" && !/id$/i.test(k) && d[k].length > best.length) best = d[k];
      });
      if (best) out.prompt = best;
    }
  } catch (e) {
    // question not captured; the reply is still saved
  }
  return out;
}

let saveTimer = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    flush();
  }, 700);
}

async function flush() {
  await loaded;
  const arr = Array.from(records.values()).sort(function (a, b) {
    return b.startedAt - a.startedAt;
  });
  arr.slice(MAX_RECORDS).forEach(function (r) {
    records.delete(r.id);
  });
  await browser.storage.local.set({ records: arr.slice(0, MAX_RECORDS) });
}

browser.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (details.method !== "POST" || !MATCH.test(details.url)) return {};

    const filter = browser.webRequest.filterResponseData(details.requestId);
    const decoder = new TextDecoder("utf-8");
    const rec = DSParser.newRecord(details.url);
    const req = readRequest(details);
    rec.prompt = req.prompt || "";
    rec.sessionId = req.sessionId || null;
    rec.reqKeys = req.keys || [];
    const parser = DSParser.makeParser(rec, {
      touch: function () {
        rec.updatedAt = Date.now();
        records.set(rec.id, rec);
        scheduleSave();
      },
    });

    filter.ondata = function (event) {
      filter.write(event.data); // pass the data through to the page unchanged
      try {
        parser.push(decoder.decode(event.data, { stream: true }));
      } catch (e) {
        console.error("DeepSeek Saver:", e);
      }
    };

    filter.onstop = function () {
      filter.close();
      try {
        parser.push(decoder.decode());
        parser.end();
      } catch (e) {
        console.error("DeepSeek Saver:", e);
      }
      flush();
    };

    filter.onerror = function () {
      rec.notes.push("filter error: " + filter.error);
      rec.done = true;
      records.set(rec.id, rec);
      flush();
    };

    return {};
  },
  URL_FILTER,
  ["blocking", "requestBody"]
);

browser.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.cmd === "delete") {
    records.delete(msg.id);
    return flush();
  }
  if (msg && msg.cmd === "clear") {
    records.clear();
    return flush();
  }
});
