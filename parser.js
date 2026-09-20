// DeepSeek SSE stream parser.
// Observed format:
//   data: {"v":{"response":{... "fragments":[{type,content}]}}}        -> initial snapshot
//   data: {"p":"response/fragments/-1/content","o":"APPEND","v":"txt"}  -> appends text
//   data: {"v":"txt"}                                                   -> continues on the last "p"
//   data: {"p":"response/fragments","o":"APPEND","v":[{...}]}           -> new fragment
//   data: {"p":"response/status","o":"SET","v":"FINISHED"}              -> status
//
// Golden rule: we only APPEND text. Any SET/DELETE operation on the content is
// ignored and noted in rec.notes, so the original text stays saved even if the
// site sends a command to replace it.

(function (root) {
  const KNOWN_EVENTS = ["ready", "update_session", "title", "close"];
  const OK_STATUS = ["FINISHED", "WIP"];
  const SUSPECT_EVENT = /filter|block|moderat|risk|sensitive|violat/i;

  function newRecord(url) {
    return {
      id: Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      url: url,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      title: "",
      status: "WIP",
      flagged: false,
      done: false,
      fragments: [],
      notes: [],
      tail: [],
    };
  }

  function makeParser(rec, hooks) {
    const touch = (hooks && hooks.touch) || function () {};
    let buf = "";
    let ev = null;
    let path = null;

    function note(msg) {
      if (rec.notes.length < 50) rec.notes.push(msg);
    }

    function setStatus(s) {
      if (typeof s !== "string") return;
      rec.status = s;
      if (OK_STATUS.indexOf(s) === -1) rec.flagged = true;
    }

    function addFragment(f) {
      rec.fragments.push({ type: f.type || "RESPONSE", content: f.content || "" });
    }

    function apply(d) {
      if (ev) {
        if (ev === "title" && typeof d.content === "string") rec.title = d.content;
        if (KNOWN_EVENTS.indexOf(ev) === -1 && SUSPECT_EVENT.test(ev)) rec.flagged = true;
        touch();
        return;
      }

      if (d.p !== undefined) path = d.p;
      const op = d.o;
      const v = d.v;

      // Initial message snapshot
      if (d.p === undefined && op === undefined && v && typeof v === "object" && v.response) {
        const r = v.response;
        rec.fragments = [];
        (r.fragments || []).forEach(addFragment);
        rec.messageId = r.message_id;
        setStatus(r.status);
        touch();
        return;
      }

      // New fragment(s)
      if (path === "response/fragments" && op === "APPEND" && Array.isArray(v)) {
        v.forEach(addFragment);
        touch();
        return;
      }

      // Fragment text
      const m = /^response\/fragments\/(-?\d+)\/content$/.exec(path || "");
      if (m && typeof v === "string") {
        if (op === undefined || op === "APPEND") {
          let f = rec.fragments[+m[1] < 0 ? rec.fragments.length + +m[1] : +m[1]];
          if (!f) {
            f = { type: "RESPONSE", content: "" };
            rec.fragments.push(f);
          }
          f.content += v;
        } else {
          note("ignored " + op + " on " + path + ": " + v.slice(0, 200));
        }
        touch();
        return;
      }

      // Other operations that try to change the content
      if (op && op !== "APPEND" && /(content|fragments)$/.test(path || "")) {
        note("ignored " + op + " on " + path);
        touch();
        return;
      }

      // Status
      if (typeof path === "string" && /status$/.test(path) && typeof v === "string") {
        setStatus(v);
        touch();
        return;
      }
      if (path === "response" && op === "BATCH" && Array.isArray(v)) {
        v.forEach(function (it) {
          if (it && /status$/.test(it.p || "")) setStatus(it.v);
        });
        touch();
      }
    }

    function handleLine(line) {
      line = line.replace(/\r$/, "");
      if (line === "") {
        ev = null;
        return;
      }
      if (line.indexOf("event:") === 0) {
        ev = line.slice(6).trim();
        return;
      }
      if (line.indexOf("data:") !== 0) return;
      const raw = line.slice(5).trim();
      rec.tail.push((ev ? "event: " + ev + " | " : "") + raw);
      if (rec.tail.length > 60) rec.tail.shift();
      let d;
      try {
        d = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (d && typeof d === "object") apply(d);
    }

    return {
      push: function (text) {
        buf += text;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          handleLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      },
      end: function () {
        if (buf) handleLine(buf);
        buf = "";
        rec.done = true;
        touch();
      },
    };
  }

  const api = { newRecord: newRecord, makeParser: makeParser };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSParser = api;
})(typeof self !== "undefined" ? self : this);
