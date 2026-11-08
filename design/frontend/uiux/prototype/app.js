/* Incident Lab prototype behaviour (UIUX-ARGON-01). Vanilla JS, no dependencies. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const icon = (id, w = 16) => `<svg width="${w}" height="${w}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const notice = (kind, ic, html) => `<div class="notice notice-${kind}" style="margin-bottom:16px">${icon(ic, 18)}<div>${html}</div></div>`;

  /* ---------------- States per screen (prototype control) ---------------- */
  const STATES = {
    landing: [["normal", "Normal"]],
    start: [["saved", "Saved shift present"], ["fresh", "No saved shift"], ["cohort-error", "Invalid cohort code"]],
    call: [["ringing", "Ringing"], ["snoozed", "Snoozed"], ["pending", "Answer pending"], ["error", "Answer failed, retry"], ["text", "Briefing · text"], ["voice", "Briefing · voice"], ["mic-denied", "Mic denied → text"], ["draining", "Audio draining"], ["in-3d", "Centered over 3D scene"]],
    board: [["broken", "Broken · populated"], ["loading", "Loading"], ["stale", "Stale / reconnecting"], ["restart", "Restart tried"], ["forbidden", "403 access lost"]],
    handoff: [["draft", "Draft"], ["save-error", "Save failed, draft kept"], ["saved", "Saved"]],
    meeting: [["team", "Team with saved handoff"], ["pending", "Handoff pending"], ["walkthrough", "Walkthrough sample"], ["loading", "Loading"], ["stale", "Partial / stale data"], ["failed", "Failed read"], ["forbidden", "Access lost (403)"]],
    workstation: [["ready", "Verified, ready to deploy"], ["self-review", "Self-review blocked"], ["ci-failing", "CI failing"], ["stale-sha", "Stale head SHA"], ["deployed", "Fix deployed"]],
    after: [["provisional", "Provisional rubric"], ["final", "Final rubric"]],
    hud: [["normal", "Normal"]],
  };
  const ORDER = ["call", "board", "handoff", "meeting", "workstation", "after"];
  let screen = "landing";
  let state = {};

  const note = (t) => { $("#pc-note").textContent = t; };

  function go(name, opts = {}) {
    if (!STATES[name]) name = "landing";
    screen = name;
    $$(".screen").forEach((s) => s.classList.toggle("is-active", s.dataset.screen === name));
    $("#pc-screen").value = name;
    const sel = $("#pc-state");
    sel.innerHTML = STATES[name].map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    sel.value = opts.state || state[name] || STATES[name][0][0];
    state[name] = sel.value;
    // Header: marketing nav on landing/start, shift bar inside the run.
    const inRun = ORDER.includes(name);
    $("#shift-bar").hidden = !inRun;
    const idx = ORDER.indexOf(name);
    $$(".shift-step").forEach((el) => {
      const i = ORDER.indexOf(el.dataset.step);
      el.classList.toggle("is-done", idx > i);
      el.classList.toggle("is-current", idx === i);
      if (idx === i) el.setAttribute("aria-current", "step"); else el.removeAttribute("aria-current");
    });
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    render(name, opts);
    if (!opts.keepScroll) window.scrollTo({ top: 0 });
    const h = $(`#screen-${name} h1, #screen-${name} h2`);
    if (opts.focus !== false && h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }

  function render(name, opts) {
    const s = state[name];
    ({ landing: () => {}, start: renderStart, call: renderCall, board: renderBoard, handoff: renderHandoff, meeting: renderMeeting, workstation: renderWorkstation, after: renderAfter, hud: () => {} })[name](s, opts);
  }

  /* ---------------- Global wiring ---------------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-go]");
    if (a) {
      e.preventDefault();
      const target = a.dataset.go;
      $("#drawer").classList.remove("is-open"); $("#menu-btn").setAttribute("aria-expanded", "false");
      const opts = {};
      if (a.dataset.mode) { opts.state = "text"; opts.mode = a.dataset.mode; }
      go(target, opts);
      if (a.dataset.scroll) setTimeout(() => document.getElementById(a.dataset.scroll)?.scrollIntoView({ block: "start" }), 10);
      return;
    }
    const sc = e.target.closest("[data-scroll]");
    if (sc) { e.preventDefault(); document.getElementById(sc.dataset.scroll)?.scrollIntoView({ block: "start" }); }
  });
  $("#menu-btn").addEventListener("click", () => {
    const open = !$("#drawer").classList.contains("is-open");
    $("#drawer").classList.toggle("is-open", open);
    $("#menu-btn").setAttribute("aria-expanded", String(open));
    if (open) $("#drawer a").focus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#drawer").classList.contains("is-open")) { $("#drawer").classList.remove("is-open"); $("#menu-btn").setAttribute("aria-expanded", "false"); $("#menu-btn").focus(); }
  });
  $("#pc-screen").addEventListener("change", (e) => go(e.target.value));
  $("#pc-state").addEventListener("change", (e) => { state[screen] = e.target.value; render(screen, {}); });
  $("#pc-vp").addEventListener("change", (e) => { document.body.dataset.vp = e.target.value; });
  $("#pc-rm").addEventListener("change", (e) => document.body.classList.toggle("reduce-motion", e.target.checked));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { $("#pc-rm").checked = true; document.body.classList.add("reduce-motion"); }
  const reduced = () => document.body.classList.contains("reduce-motion");

  /* Roving tablists (ArrowLeft/Right, Home/End) */
  function tablist(root, onSelect) {
    const tabs = $$('[role="tab"]', root);
    const select = (t, focus) => {
      tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; });
      if (focus) t.focus();
      onSelect(t, tabs.indexOf(t));
    };
    tabs.forEach((t) => {
      t.addEventListener("click", () => select(t, false));
      t.addEventListener("keydown", (e) => {
        const i = tabs.indexOf(t);
        let n = null;
        if (e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft") n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === "Home") n = tabs[0];
        if (e.key === "End") n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); select(n, true); }
      });
    });
    return select;
  }

  /* 200 ms intent prefetch (demonstrates router.prefetch timing) */
  $$("[data-prefetch]").forEach((el) => {
    let t;
    const start = () => { clearTimeout(t); t = setTimeout(() => { el.dataset.prefetched = "1"; const h = $("#prefetch-hint"); if (h && el.closest("#screen-landing")) { h.textContent = `Prefetched ${el.dataset.prefetch} after 200 ms of intent`; h.classList.add("is-ready"); } note(`prefetch ${el.dataset.prefetch}`); }, 200); };
    const stop = () => clearTimeout(t);
    el.addEventListener("pointerenter", start); el.addEventListener("focus", start);
    el.addEventListener("pointerleave", stop); el.addEventListener("blur", stop);
  });

  /* ---------------- 1. Landing preview ---------------- */
  tablist($("#preview .tabs"), (t) => {
    $$("#preview .preview-panel").forEach((p) => { const on = p.id === t.getAttribute("aria-controls"); p.classList.toggle("is-active", on); p.hidden = !on; if (on) $("#pv-url").textContent = p.dataset.url; });
  });

  /* ---------------- 2. Start ---------------- */
  function renderStart(s) {
    $("#resume-card").hidden = s === "fresh";
    $("#replace-confirm").hidden = true; $("#replace-btn").setAttribute("aria-expanded", "false");
    const err = $("#c-code-err"), code = $("#c-code");
    if (s === "cohort-error") { code.value = "ABC12"; $("#c-name").value = "Nova"; showCodeError("Codes are 6 characters. Check the code from your host."); }
    else { err.hidden = true; code.removeAttribute("aria-invalid"); }
  }
  function showCodeError(msg) { const err = $("#c-code-err"); err.hidden = false; $("span", err).textContent = msg; $("#c-code").setAttribute("aria-invalid", "true"); }
  $("#replace-btn").addEventListener("click", (e) => { const c = $("#replace-confirm"); c.hidden = !c.hidden; e.currentTarget.setAttribute("aria-expanded", String(!c.hidden)); if (!c.hidden) $("#replace-yes").focus(); });
  $("#replace-no").addEventListener("click", () => { $("#replace-confirm").hidden = true; $("#replace-btn").setAttribute("aria-expanded", "false"); $("#replace-btn").focus(); });
  $("#replace-yes").addEventListener("click", () => go("call"));
  $("#c-code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (e.target.value.length === 6) { $("#c-code-err").hidden = true; e.target.removeAttribute("aria-invalid"); } });
  $("#cohort-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#c-code").value;
    if (v.length !== 6) { showCodeError("Codes are 6 characters. Check the code from your host."); $("#c-code").focus(); return; }
    if (v !== "NORTH6") { showCodeError(`No cohort uses ${v}. Your name and level are kept; try again.`); $("#c-code").focus(); return; }
    go("call");
  });
  $$(".source-toggle button").forEach((b) => b.addEventListener("click", () => {
    $$(".source-toggle button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("#hdr-source").innerHTML = b.dataset.src === "api" ? '<span class="dot"></span>Team API' : '<span class="dot"></span>Rehearsal fixture';
  }));

  /* ---------------- 3. Call ---------------- */
  const SCRIPT = {
    briefing: [["dana", "Thanks for picking up. Checkout is failing for about a third of shoppers during the flash sale."], ["dana", "Error rate went from 0.4% to 31.2%. Start by checking when the errors began and what changed around then."], ["you", "Was there a deploy tonight?"], ["dana", "A release went out at 01:47. Compare that time with the first checkout errors."]],
    help: [["you", "I'm stuck. Where should I look?"], ["dana", "Look at who is failing. Are the errors spread evenly, or only for some shoppers?"], ["dana", "The logs mention a missing key. Which customers might not have it?"]],
    debrief: [["dana", "Checkout is stable and the fix is live. Give me the two-line update you'd send our VP."], ["you", "Guest checkout failed after v2.14.0. We rolled back at 02:06, shipped a tested fix at 10:02, and discounts are back."], ["dana", "Clear impact, cause and action. Add the remaining risk next time."]],
  };
  let callTimer;
  function renderCall(s, opts = {}) {
    const card = $("#call-card"); const stage = $("#call-stage");
    clearInterval(callTimer);
    stage.classList.toggle("in-3d", s === "in-3d");
    const briefing = ["text", "voice", "mic-denied", "draining"].includes(s);
    card.classList.toggle("is-briefing", briefing);
    $("#snooze-note").hidden = s !== "snoozed";
    $("#call-err").textContent = s === "snoozed" ? "34.8%" : "31.2%";
    $("#call-clock").textContent = s === "snoozed" ? "02:04" : "02:04";
    const st = $("#call-status");
    const at = $("#answer-text"), av = $("#answer-voice");
    at.disabled = av.disabled = s === "pending";
    st.innerHTML = s === "pending" ? `<div class="notice notice-info">${icon("clock-c", 18)}<span>Connecting to Dana…</span></div>`
      : s === "error" ? `<div class="notice notice-danger">${icon("alert", 18)}<div>Couldn't reach Dana. Your place is saved. <button class="btn" style="min-height:36px;margin-top:6px" id="retry-answer">Try again</button></div></div>` : "";
    $("#retry-answer")?.addEventListener("click", () => setCall("text"));
    if (briefing) {
      const mode = opts.mode || "briefing";
      selectMode(mode, false);
      const vb = $("#voice-banner"); const mic = $("#mic-toggle");
      $("#wave").hidden = s !== "voice";
      mic.setAttribute("aria-pressed", String(s === "voice"));
      const micLbl = $("#mic-label"); if (micLbl) micLbl.textContent = s === "voice" ? "Mute" : "Use Voice";
      $("#brief-conn").textContent = s === "voice" ? "Voice connected · Live Captions" : "Connected by text · Live Captions";
      vb.innerHTML = s === "mic-denied" ? `<div class="notice notice-warning">${icon("mic", 18)}<span>Microphone is blocked. You're now on text, and Dana's replies stay captioned. Allow the mic in browser settings to switch back.</span></div>`
        : s === "draining" ? `<div class="notice notice-info">${icon("info", 18)}<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span>Dana is finishing her last sentence.</span><button class="btn" style="min-height:36px">Resume audio</button><button class="btn btn-ghost" style="min-height:36px">Skip remaining audio</button></div></div>` : "";
      let sec = 12; callTimer = setInterval(() => { sec++; $("#brief-timer").textContent = `00:${String(sec).padStart(2, "0")}`; }, 1000);
      $("#msg").focus({ preventScroll: true });
    }
  }
  function setCall(s) { state.call = s; $("#pc-state").value = s; renderCall(s); }
  function selectMode(mode, focus) {
    $$('.mode-tabs [role="tab"]').forEach((t) => { const on = t.dataset.mode === mode; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
    $("#brief-mode-label").textContent = mode[0].toUpperCase() + mode.slice(1);
    const log = $("#captions"); log.innerHTML = "";
    SCRIPT[mode].forEach(([who, text], i) => {
      const add = () => { log.insertAdjacentHTML("beforeend", `<div class="msg msg-${who}"><span class="who">${who === "dana" ? "Dana" : "You"}</span>${text}</div>`); log.scrollTop = log.scrollHeight; };
      reduced() ? add() : setTimeout(add, i * 260);
    });
  }
  tablist($(".mode-tabs"), (t) => selectMode(t.dataset.mode, false));
  $("#answer-text").addEventListener("click", () => { setCall("pending"); setTimeout(() => setCall("text"), reduced() ? 0 : 600); });
  $("#answer-voice").addEventListener("click", () => { setCall("pending"); setTimeout(() => setCall(confirm("Prototype: simulate the browser granting microphone access?\nOK = allow, Cancel = block") ? "voice" : "mic-denied"), 300); });
  $("#snooze").addEventListener("click", () => setCall("snoozed"));
  $("#mic-toggle").addEventListener("click", () => setCall(state.call === "voice" ? "text" : "voice"));
  $("#compose").addEventListener("submit", (e) => {
    e.preventDefault(); const v = $("#msg").value.trim(); if (!v) return;
    const log = $("#captions");
    log.insertAdjacentHTML("beforeend", `<div class="msg msg-you"><span class="who">You</span>${v.replace(/</g, "&lt;")}</div>`);
    $("#msg").value = "";
    setTimeout(() => { log.insertAdjacentHTML("beforeend", `<div class="msg msg-dana"><span class="who">Dana</span>Good question. Check the deploy diff for anything that reads customer data.</div>`); log.scrollTop = log.scrollHeight; }, reduced() ? 0 : 500);
    log.scrollTop = log.scrollHeight;
  });

  /* ---------------- 4. Night board ---------------- */
  // Shared x positions (0..300) so the three charts align: 01:47 deploy, 01:50 errors, 02:04 alert.
  const X = { deploy: 120, errors: 150, alert: 270 };
  const SERIES = {
    err: { label: "Checkout error rate", unit: "%", now: "31.2", base: "Baseline 0.4%", pts: [0.4, 0.4, 0.4, 0.5, 18.6, 24, 28, 30, 31.2], max: 40, color: "#b91c1c", tone: "danger", delta: "+30.8 pts" },
    ord: { label: "Successful orders", unit: "/min", now: "290", base: "Baseline 420/min", pts: [420, 418, 421, 419, 340, 315, 300, 294, 290], max: 500, color: "#1d4ed8", tone: "danger", delta: "−31%" },
    p95: { label: "p95 checkout latency", unit: "ms", now: "1,450", base: "Baseline 380 ms", pts: [380, 384, 379, 390, 980, 1200, 1350, 1420, 1450], max: 1600, color: "#7c3aed", tone: "danger", delta: "+282%" },
  };
  function spark(sr, recovered) {
    const pts = recovered ? [...sr.pts.slice(0, 7), sr.pts[0] * 1.02, sr.pts[0]] : sr.pts;
    const xs = [0, 40, 80, 120, 150, 190, 230, 270, 300];
    const y = (v) => 76 - (v / sr.max) * 70;
    const d = pts.map((v, i) => `${i ? "L" : "M"}${xs[i]} ${y(v).toFixed(1)}`).join(" ");
    const mk = (x, c) => `<line x1="${x}" y1="0" x2="${x}" y2="80" stroke="${c}" stroke-dasharray="3 3" stroke-width="1.2"/>`;
    return `<svg class="spark" viewBox="0 0 300 80" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${y(sr.pts[0]).toFixed(1)}" x2="300" y2="${y(sr.pts[0]).toFixed(1)}" stroke="#cbd5e1" stroke-dasharray="2 4"/>
      ${mk(X.deploy, "#94a3b8")}${mk(X.errors, "#b45309")}${mk(X.alert, "#b91c1c")}
      <path d="${d} L300 80 L0 80Z" fill="${sr.color}" opacity=".08"/>
      <path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="300" cy="${y(pts[pts.length - 1]).toFixed(1)}" r="3.5" fill="${sr.color}"/></svg>`;
  }
  function renderBoard(s) {
    const k = $("#kpis");
    $("#board-notice").innerHTML = s === "stale" ? notice("warning", "refresh", "<b>Reconnecting.</b> Telemetry last updated 02:05:12 (18 s ago). Numbers below may be behind; actions are paused until we reconnect.")
      : s === "forbidden" ? notice("danger", "lock", '<b>You no longer have access to this incident.</b> Your host may have ended the cohort. <a href="#start" data-go="start">Return to start</a>')
      : "";
    if (s === "loading") { k.innerHTML = [0, 1, 2].map(() => `<div class="card kpi"><div class="skeleton" style="height:14px;width:50%"></div><div class="skeleton" style="height:34px;width:40%;margin-top:12px"></div><div class="skeleton" style="height:80px;margin-top:12px"></div></div>`).join(""); }
    else {
      k.innerHTML = Object.values(SERIES).map((sr) => `<div class="card kpi" style="${s === "stale" ? "opacity:.6" : ""}">
        <div class="kpi-top"><span class="kpi-label">${sr.label}</span><span class="badge badge-${sr.tone}">${icon("alert", 12)}${sr.delta}</span></div>
        <div class="kpi-val"><b style="color:${sr === SERIES.err ? "var(--danger)" : "var(--ink)"}">${sr.now}</b><span>${sr.unit}</span></div>
        <div class="kpi-base">${sr.base}</div>${spark(sr, false)}</div>`).join("");
    }
    renderLogs();
    $("#try-result").innerHTML = s === "restart" ? notice("info", "info", "<b>Restart tried at 02:05.</b> Errors dipped to 12% for 20 s, then returned to 31%. The cause is still in the code.") : "";
    $$("#screen-board button.action-btn").forEach((b) => (b.disabled = s === "stale" || s === "forbidden"));
  }
  const LOGS = [
    ["02:04:59", "error", "KeyError: 'tier' · checkout/pricing.py:18 in loyalty_percent · guest=true"],
    ["02:04:51", "error", "POST /checkout 500 · cart=c_91a2 · guest=true"],
    ["02:04:40", "warn", "p95 latency 1,450 ms above SLO 800 ms"],
    ["02:03:58", "error", "KeyError: 'tier' · checkout/pricing.py:18 · guest=true"],
    ["02:03:31", "info", "POST /checkout 200 · cart=c_77f0 · tier=gold"],
    ["01:50:02", "error", "First KeyError: 'tier' after deploy v2.14.0"],
    ["01:47:00", "info", "Deploy v2.14.0 · Add loyalty tier discounts"],
  ];
  function renderLogs() {
    const q = ($("#log-q").value || "").toLowerCase();
    $("#log-list").innerHTML = LOGS.filter((l) => l.join(" ").toLowerCase().includes(q)).map(([t, lv, m]) =>
      `<div class="log-row"><span class="muted">${t}</span><span class="lvl lvl-${lv}">${lv.toUpperCase()}</span><span>${m}</span><button class="pin-btn" data-pin="${t} ${m.replace(/"/g, "&quot;")}">${icon("pin", 12)} Pin</button></div>`).join("") || `<div class="log-row"><span></span><span></span><span class="muted">No log lines match “${q}”.</span></div>`;
  }
  $("#log-q").addEventListener("input", renderLogs);
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-pin]"); if (!p) return;
    $("#evidence").insertAdjacentHTML("afterbegin", `<div class="evidence-item is-new">${icon("pin", 16).replace("<svg", '<svg style="color:var(--accent);flex:none;margin-top:2px"')}<span><b>You</b> · ${p.dataset.pin}</span></div>`);
    $("#ev-count").textContent = $$("#evidence .evidence-item").length;
    p.textContent = "Pinned"; p.disabled = true;
  });
  tablist($("#screen-board .board-grid .tabs"), (t) => { $$("#screen-board [role=tabpanel]").forEach((p) => (p.hidden = p.id !== t.getAttribute("aria-controls"))); });
  $$("[data-try]").forEach((b) => b.addEventListener("click", () => {
    $("#try-result").innerHTML = b.dataset.try === "restart" ? notice("info", "info", "<b>Restarted.</b> Errors dipped, then returned to 31%. The cause is still in the code.") : notice("info", "info", "<b>Scaled to 6 instances.</b> No change. Extra capacity does not fix a code error.");
  }));
  $("#hint-btn").addEventListener("click", () => go("call", { state: "text", mode: "help" }));
  const rbDlg = $("#rollback-dlg"); let rbOpener;
  $("#rollback-open").addEventListener("click", (e) => { rbOpener = e.currentTarget; rbDlg.showModal(); $("#rb-cancel").focus(); });
  $("#rb-cancel").addEventListener("click", () => rbDlg.close());
  rbDlg.addEventListener("close", () => rbOpener?.focus());
  $("#rb-confirm").addEventListener("click", () => {
    const b = $("#rb-confirm"); b.disabled = true; b.textContent = "Rolling back…";
    setTimeout(() => {
      rbDlg.close(); b.disabled = false; b.textContent = "Roll back to v2.13.9";
      $("#mit-state").className = "badge badge-success"; $("#mit-state").textContent = "Recovered";
      $("#loyalty-badge").className = "badge badge-warning"; $("#loyalty-badge").innerHTML = `${icon("tag", 13)}Loyalty discounts: OFF`;
      $("#kpis").innerHTML = Object.values(SERIES).map((sr) => `<div class="card kpi"><div class="kpi-top"><span class="kpi-label">${sr.label}</span><span class="badge badge-success">${icon("check", 12)}Baseline</span></div><div class="kpi-val"><b style="color:var(--success)">${{ err: "0.4", ord: "418", p95: "390" }[Object.keys(SERIES).find((k) => SERIES[k] === sr)]}</b><span>${sr.unit}</span></div><div class="kpi-base">${sr.base}</div>${spark(sr, true)}</div>`).join("");
      $("#try-result").innerHTML = `${notice("success", "check-c", "<b>Recovered at 02:06:10.</b> All three metrics are back at baseline.")}<button class="btn btn-primary" data-go="handoff" style="width:100%">Write the handoff ${icon("arrow")}</button>`;
    }, reduced() ? 0 : 900);
  });

  /* ---------------- 5. Handoff ---------------- */
  function renderHandoff(s) {
    $("#ho-notice").innerHTML = s === "save-error" ? notice("danger", "alert", "<b>Couldn't save the handoff.</b> Your text is still here and saved in this browser. <button class='btn' style='min-height:36px;margin-left:6px' id='ho-retry'>Try again</button>") : "";
    $("#ho-saved").innerHTML = s === "saved" ? `<span style="color:var(--success);font-weight:600">${icon("check", 14)} Saved 02:09 · visible to the morning team</span>` : "Draft saved in this browser";
    $("#ho-retry")?.addEventListener("click", () => { state.handoff = "saved"; $("#pc-state").value = "saved"; renderHandoff("saved"); });
  }
  $("#ho-form").addEventListener("submit", (e) => { e.preventDefault(); state.handoff = "saved"; $("#pc-state").value = "saved"; renderHandoff("saved"); });

  /* ---------------- 6. Morning meeting ---------------- */
  let beat = 0, rating = 0;
  const PJ_METRICS = [["Checkout errors", "0.4%", "31.2%", "0.4%"], ["Orders / min", "420", "290", "418"], ["p95 latency", "380 ms", "1,450 ms", "390 ms"]];
  function projector(s) {
    const pj = $("#projector");
    const states = {
      loading: ["refresh", "#93c5fd", "Loading the overnight summary…", "The room screen updates when the incident record arrives."],
      failed: ["alert", "#f87171", "Couldn't load the overnight summary", "Dana can still run the meeting from her notes. Retry from the panel."],
      forbidden: ["lock", "#fbbf24", "This meeting is no longer shared with you", "Ask your host to re-add you to the cohort."],
      pending: ["clock-c", "#fbbf24", "Waiting for the night handoff", "Metrics are ready. The handoff note appears here once it is saved."],
    };
    const brand = `<div class="pj-head"><div class="pj-brand"><span class="brand-mark" style="width:3.2cqi;height:3.2cqi;border-radius:.8cqi">${icon("bolt", 14)}</span>ShopNorth · Morning standup</div><div class="pj-beat">BEAT ${beat + 1} / 3</div></div>`;
    if (states[s] && !(s === "pending" && beat === 0)) {
      const [ic, c, h, p] = states[s];
      pj.innerHTML = `${brand}<div class="pj-state" style="position:relative;inset:auto;flex:1"><div><div class="pj-ic" style="color:${c}">${icon(ic, 24)}</div><h3>${h}</h3><p>${p}</p></div></div>`;
      pj.setAttribute("aria-label", h); return;
    }
    const staleTag = s === "stale" ? `<span style="color:#fbbf24">· latest values from 09:02 (partial)</span>` : "";
    const foot = `<div class="pj-foot"><span>Incident inc_468a2937 · ${s === "walkthrough" ? "Walkthrough sample" : "Team incident"} ${staleTag}</span><span class="num">09:15</span></div>`;
    let body = "";
    if (beat === 0) {
      body = `<div><div class="pj-title">Guest checkouts failed for 16 minutes overnight</div><div class="pj-sub">v2.14.0 shipped at 01:47 · errors from 01:50 · paged at 02:04</div></div>
      <div class="pj-matrix"><div></div><div class="h">Baseline</div><div class="h during">During</div><div class="h after">Latest</div>
      ${PJ_METRICS.map(([m, a, b, c]) => `<div class="m">${m}</div><div class="v">${a}</div><div class="v during">${b}</div><div class="v after dim">${c}</div>`).join("")}</div>`;
    } else if (beat === 1) {
      body = `<div><div class="pj-title">Rollback restored checkout. Discounts are still off.</div><div class="pj-sub">Remaining risk: pricing.py:18 still reads profile["tier"]</div></div>
      <div class="pj-matrix"><div></div><div class="h">Baseline</div><div class="h during">During</div><div class="h after">Latest</div>
      ${PJ_METRICS.map(([m, a, b, c]) => `<div class="m">${m}</div><div class="v">${a}</div><div class="v during dim">${b}</div><div class="v after">${s === "stale" && m === "p95 latency" ? "—" : c}</div>`).join("")}</div>
      <div class="pj-timeline"><div class="pj-tl-item"><b>01:47</b>v2.14.0 deploy</div><div class="pj-tl-item bad"><b>01:50</b>Errors begin</div><div class="pj-tl-item warn"><b>02:04</b>Dana pages</div><div class="pj-tl-item good"><b>02:06</b>Rollback v2.13.9</div></div>`;
    } else {
      body = `<div><div class="pj-title">This morning: ship the safe fix with a review</div><div class="pj-sub">Default the tier, add guest tests, deploy to turn discounts back on</div></div>
      <div class="pj-assign"><div><span class="tag">Workstation 1</span><b>Write the fix</b><span>.get("tier") with no extra discount</span></div><div><span class="tag">Workstation 2</span><b>Review the PR</b><span>Check guest, gold and unknown tiers</span></div><div><span class="tag">Done when</span><b>CI + review + deploy</b><span>Loyalty discounts back on</span></div></div>`;
    }
    pj.innerHTML = brand + body + foot;
    pj.setAttribute("aria-label", `Shared projector, beat ${beat + 1} of 3`);
  }
  function panel(s) {
    const body = $("#mp-body");
    $$(".step-pill").forEach((p, i) => { p.classList.toggle("is-done", i < beat); if (i === beat) p.setAttribute("aria-current", "step"); else p.removeAttribute("aria-current"); p.setAttribute("aria-selected", String(i === beat)); p.tabIndex = i === beat ? 0 : -1; });
    $("#mt-source").textContent = s === "walkthrough" ? "Walkthrough sample" : "Team incident";
    $("#mt-source").className = s === "walkthrough" ? "badge" : "badge badge-info";
    const foot = $("#mp-foot");
    if (s === "loading") { foot.hidden = true; body.innerHTML = `<div class="skeleton" style="height:24px;width:70%"></div><div class="skeleton" style="height:140px"></div><div class="skeleton" style="height:60px"></div>`; return; }
    if (s === "failed") { foot.hidden = true; body.innerHTML = `${notice("danger", "alert", "<b>Couldn't load the incident record.</b> Nothing is lost. Try again, or continue with the walkthrough sample.")}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" id="mt-retry">${icon("refresh")} Try again</button><button class="btn" id="mt-sample">Use walkthrough sample</button></div>`; $("#mt-retry").onclick = () => setMeeting("team"); $("#mt-sample").onclick = () => setMeeting("walkthrough"); return; }
    if (s === "forbidden") { foot.hidden = true; body.innerHTML = `${notice("danger", "lock", "<b>You no longer have access to this meeting.</b> Your host may have ended the cohort session.")}<a class="btn" href="#start" data-go="start">Return to start</a>`; return; }
    foot.hidden = false;
    const pre = s === "stale" ? notice("warning", "refresh", "Some values are from 09:02. p95 latency for the latest window hasn't arrived yet.") : s === "walkthrough" ? notice("info", "info", "This is a sample incident. Start a team shift to see your own handoff.") : "";
    const cmp = `<table class="cmp-table"><caption class="sr-only">Metrics before, during and after the incident</caption><thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">During</th><th scope="col">Latest</th></tr></thead><tbody>${PJ_METRICS.map(([m, a, b, c]) => `<tr><th scope="row" style="font-weight:600;text-align:left">${m}</th><td>${a}</td><td class="during">${b}</td><td class="after">${s === "stale" && m === "p95 latency" ? '<span class="muted">pending</span>' : c}</td></tr>`).join("")}</tbody></table>`;
    if (beat === 0) {
      body.innerHTML = `${pre}<span class="eyebrow">Beat 1 of 3</span><h2>Overnight impact</h2><p class="muted">Guest checkouts crashed with <span class="mono">KeyError: 'tier'</span> from 01:50 until the 02:06 rollback, during the flash sale.</p>${cmp}`;
    } else if (beat === 1) {
      const ho = s === "pending" ? notice("warning", "clock-c", "<b>The night handoff hasn't been saved yet.</b> Dana will summarise from the incident log. The note appears here when demo-a saves it.")
        : `<dl class="handoff-fields"><div><dt>What happened</dt><dd>Guest checkouts failed with KeyError: 'tier' after v2.14.0.</dd></div><div><dt>Current state</dt><dd>On v2.13.9. Metrics at baseline. Loyalty discounts off.</dd></div><div><dt>What was tried</dt><dd>Restart (errors returned), rollback (recovered in ~10 s).</dd></div><div><dt>Remaining risk</dt><dd>pricing.py:18 needs a default and a guest regression test.</dd></div></dl>`;
      const rate = s === "pending" ? "" : `<div><p style="font-weight:600;font-size:14px;margin-bottom:8px" id="rate-l">How useful was this handoff?</p><div class="rating" role="group" aria-labelledby="rate-l">${[1, 2, 3, 4, 5].map((n) => `<button aria-pressed="${n === rating}" data-rate="${n}" aria-label="${n} of 5">${n}</button>`).join("")}</div></div>`;
      body.innerHTML = `${pre}<span class="eyebrow">Beat 2 of 3 · from demo-a at 02:09</span><h2>Recovery and remaining risk</h2>${ho}${rate}`;
      $$("[data-rate]").forEach((b) => b.addEventListener("click", () => { rating = +b.dataset.rate; $$("[data-rate]").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.rate === rating))); }));
    } else {
      body.innerHTML = `${pre}<span class="eyebrow">Beat 3 of 3</span><h2>Your morning assignment</h2>
        <div class="role-card"><div class="ic">${icon("git", 20)}</div><div><b>You're the author at Workstation 1</b><p class="muted" style="font-size:13.5px">Write the fix and its tests. Nova reviews at Workstation 2.</p></div></div>
        <ol class="runbook"><li>Open <span class="mono">checkout/pricing.py</span> in VS Code.</li><li>Use <span class="mono">profile.get("tier")</span>; unknown tiers get no extra discount.</li><li>Add tests: guest $100 → $80, gold → $72, "platinum" → $80.</li><li>Open a PR and request Nova's review.</li></ol>`;
    }
    $("#mp-back").disabled = beat === 0;
    $("#mp-next").innerHTML = beat === 2 ? `Continue to workstation ${icon("arrow")}` : "Next";
  }
  function renderMeeting(s) { if (s !== state._lastMeeting) { beat = 0; state._lastMeeting = s; } projector(s); panel(s); }
  function setMeeting(s) { state.meeting = s; $("#pc-state").value = s; renderMeeting(s); }
  function setBeat(b) { beat = Math.max(0, Math.min(2, b)); projector(state.meeting); panel(state.meeting); }
  $("#mp-back").addEventListener("click", () => setBeat(beat - 1));
  $("#mp-next").addEventListener("click", () => (beat === 2 ? go("workstation") : setBeat(beat + 1)));
  $$(".step-pill").forEach((p, i) => {
    p.addEventListener("click", () => setBeat(i));
    p.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); setBeat(beat + 1); $$(".step-pill")[beat].focus(); } if (e.key === "ArrowLeft") { e.preventDefault(); setBeat(beat - 1); $$(".step-pill")[beat].focus(); } });
  });

  /* ---------------- 7. Workstation ---------------- */
  let role = "author";
  const FLOWS = {
    author: [["done", "Open the repo in VS Code", "shopnorth-checkout · branch fix/guest-tier"], ["done", "Change pricing.py:18", 'tier = customer.profile.get("tier")'], ["done", "Add five pricing tests", "guest, gold, no tier, platinum, error returns $0 fails"], ["now", "Wait for Nova's review", "GitHub requests a non-author approval"], ["", "Deploy the fix", "Loyalty discounts turn back on"]],
    reviewer: [["done", "Open PR #42 on GitHub", "Requested by demo-a"], ["now", "Read the diff", "Check every tier path, not just guests"], ["", "Run or read the tests", "Confirm guest $100 → $80"], ["", "Submit a substantive review", "Approve or request changes with a comment"]],
    explore: [["done", "Read what broke", "Guests have no tier key"], ["now", "Compare old and new line 18", "[\"tier\"] vs .get(\"tier\")"], ["", "Answer: what does a guest pay?", "$100 cart → $80 after sale discount"], ["", "Watch the fix deploy", "Discounts return for members"]],
  };
  function check(kind, label, sub) { const ic = { ok: "check-c", bad: "x-circle", wait: "clock-c" }[kind] || "clock-c"; return `<div class="check"><svg class="${kind}"><use href="#i-${kind === "bad" ? "x-c" : ic}"/></svg><span>${label}</span><small>${sub}</small></div>`; }
  function renderWorkstation(s) {
    $("#flow").innerHTML = FLOWS[role].map(([st, h, p], i) => `<div class="flow-step ${st}"><span class="n">${st === "done" ? icon("check", 16) : i + 1}</span><div><h4>${h}</h4><p class="${i === 1 || h.includes("line") ? "mono" : ""}" style="font-size:13px">${p}</p></div></div>`).join("");
    $("#ws-role-badge").textContent = { author: "Author · demo-a", reviewer: "Reviewer · Nova", explore: "Explore · guided review" }[role];
    const c = { ci: ["ok", "CI · 5 of 5 tests", "pricing-tests 41 s"], rv: ["ok", "Review · approved by Nova", "substantive, not the author"], mg: ["ok", "Merged into main", "09:58"], sha: ["ok", "Verified head 7c1e9ab", "matches deploy target"] };
    let blocker = "";
    if (s === "self-review") { c.rv = ["bad", "Review · approved by demo-a", "author can't approve"]; c.mg = ["wait", "Not merged", "waiting on review"]; blocker = "<b>Deploy blocked:</b> the author can't review their own PR. Ask Nova to review on GitHub."; }
    if (s === "ci-failing") { c.ci = ["bad", "CI · 4 of 5 tests", "test_error_returns_zero failed"]; c.mg = ["wait", "Not merged", "CI must pass"]; blocker = "<b>Deploy blocked:</b> a test that returns $0 on error should fail, and it passed. Fix the test, then push again."; }
    if (s === "stale-sha") { c.sha = ["bad", "Head changed to 9d02f1c", "new commit after review"]; blocker = "<b>New commit pushed after verification.</b> The deploy confirmation was cleared. Verify again so the deploy targets the reviewed code."; }
    $("#checks").innerHTML = Object.values(c).map((x) => check(...x)).join("");
    $("#ws-notice").innerHTML = blocker ? notice("danger", "lock", blocker) : s === "deployed" ? notice("success", "check-c", '<b>Fix deployed at 10:02.</b> Error rate 0.4%, loyalty discounts ON. <a href="#after" data-go="after">Continue to the debrief</a>') : "";
    const ready = !blocker && s !== "deployed";
    $("#deploy-btn").disabled = !ready;
    $("#deploy-btn").textContent = s === "deployed" ? "Deployed" : "Deploy fix";
    $("#pr-state").innerHTML = `${icon("git", 14)}${s === "deployed" || !blocker ? "Merged" : "Open"}`;
    $("#pr-state").style.background = blocker ? "#1f6feb" : "#8250df";
    $("#pr-sha").textContent = `head ${s === "stale-sha" ? "9d02f1c" : "7c1e9ab"} · shopnorth-checkout`;
  }
  tablist($("#role-tabs"), (t) => { role = t.dataset.role; renderWorkstation(state.workstation); });
  $("#verify-btn").addEventListener("click", () => { const b = $("#verify-btn"); b.disabled = true; b.innerHTML = `${icon("refresh")} Checking GitHub…`; setTimeout(() => { b.disabled = false; b.innerHTML = `${icon("refresh")} Verify on GitHub`; if (state.workstation === "stale-sha") { state.workstation = "ready"; $("#pc-state").value = "ready"; } renderWorkstation(state.workstation); }, reduced() ? 0 : 700); });
  const dpDlg = $("#deploy-dlg");
  $("#deploy-btn").addEventListener("click", () => { dpDlg.showModal(); $("#dp-cancel").focus(); });
  $("#dp-cancel").addEventListener("click", () => dpDlg.close());
  dpDlg.addEventListener("close", () => $("#deploy-btn").focus());
  $("#dp-confirm").addEventListener("click", () => { dpDlg.close(); state.workstation = "deployed"; $("#pc-state").value = "deployed"; renderWorkstation("deployed"); });

  /* ---------------- 8. After ---------------- */
  const RUBRIC = [["Diagnosis", 4, "Linked the 01:47 deploy to the first errors and the missing tier key."], ["Mitigation", 4, "Rolled back before deep log reading; stated the discount trade-off."], ["Validation", 4, "Checked all three metrics returned to baseline."], ["Communication", 2, "Impact, cause and action were clear. Remaining risk was missing from the VP update."], ["Collaboration", 4, "Useful handoff (rated 4/5) and a reviewed PR."]];
  function renderAfter(s) {
    $("#rubric-state").textContent = s === "final" ? "Final" : "Provisional";
    $("#rubric-state").className = s === "final" ? "badge badge-success" : "badge badge-warning";
    $("#rubric").innerHTML = RUBRIC.map(([n, sc, p]) => `<div class="rubric-row"><b>${n}</b><span style="display:flex;gap:10px;align-items:center"><span class="score-pips" aria-hidden="true"><i class="${sc >= 2 ? "on" : ""}"></i><i class="${sc >= 4 ? "on" : ""}"></i></span><span class="num" style="font-weight:700">${sc}/4</span></span><p>${p}</p></div>`).join("");
  }
  $("#conn-btn").addEventListener("click", (e) => { const b = e.currentTarget; const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "Requested · waiting for Nova" : "Connect"; });

  /* ---------------- Boot ---------------- */
  const initial = (location.hash || "#landing").slice(1);
  go(STATES[initial] ? initial : "landing", { focus: false });
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (STATES[h] && h !== screen) go(h); });
  window.__proto = { go, setBeat, state: () => ({ screen, state: { ...state }, beat }) };
})();
