/* global SDT_FPA, SDT_FPA_DATA */
(function () {
  "use strict";

  if (typeof SDT_FPA === "undefined") {
    return;
  }

  var POSITIONS = [
    { key: "qb", label: "QB" },
    { key: "rb", label: "RB" },
    { key: "wr", label: "WR" },
    { key: "te", label: "TE" },
    { key: "off", label: "OFF" },
  ];

  var FORMAT_OPTS = [
    { value: "standard", label: "STD" },
    { value: "half", label: "½ PPR" },
    { value: "ppr", label: "PPR" },
  ];

  var VIEW_OPTS = [
    { value: "raw", label: "Raw" },
    { value: "adjusted", label: "Adjusted" },
  ];

  var ESPN_ABBR = { WAS: "wsh" };

  // Only the per-reception value varies by scoring format (mirrors the ingest
  // pipeline's scoreRow). Everything else is constant across formats.
  var RECEPTION_BY_FORMAT = { standard: "0", half: "0.5", ppr: "1" };
  var FORMAT_LABEL = { standard: "Standard", half: "Half PPR", ppr: "PPR" };

  var FPA_EXPLAINER =
    "Fantasy Points Allowed is a metric that indicates how good or bad each " +
    "NFL defense is at limiting fantasy production to their opponents. The " +
    "higher the FPA value, the more fantasy points the team gives up. On the " +
    "flip side, the lower the FPA value, the less fantasy points a team gives up.";

  var VIEW_TIP =
    "Raw FPA is the average fantasy points allowed. Adjusted (aFPA) corrects " +
    "for strength of schedule, so defenses are compared as if they each " +
    "played a neutral schedule.";

  var AFPA_EXPLAINER =
    "Adjusted Fantasy Points Allowed (aFPA) takes raw FPA and corrects it for " +
    "strength of schedule. A defense that has faced stronger-than-average " +
    "offenses has its number nudged down, while one that has faced " +
    "weaker-than-average offenses is nudged up — so every team is measured as " +
    "if it played a neutral schedule. This makes matchups easier to compare " +
    "across defenses that haven't faced the same opponents.";

  // Rank 1 = easiest (most pts allowed). Rank 32 = toughest (fewest allowed).
  function tierHeat(rank) {
    if (rank <= 8) return "fpa-app-heat--smash"; // light green (easiest)
    if (rank <= 16) return ""; // white
    if (rank <= 24) return "fpa-app-heat--good"; // pale yellow
    return "fpa-app-heat--tough"; // light red (toughest)
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // A titled paragraph block inside the Methodology popover.
  function methSection(title, text) {
    var sec = el("div", "fpa-app-scoring-group");
    sec.appendChild(el("div", "fpa-app-meth-title", title));
    sec.appendChild(el("p", "fpa-app-meth-text", text));
    return sec;
  }

  // Inline SVG icons (lucide shapes). Unicode symbol glyphs render
  // inconsistently across themes/fonts (e.g. Divi shows tofu or an emoji
  // gear), so we draw real SVGs that inherit currentColor and size cleanly.
  var ICONS = {
    info:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    sliders:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>',
    chevron:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
  };

  function icon(name, className) {
    var span = el("span", "fpa-app-icon" + (className ? " " + className : ""));
    span.innerHTML = ICONS[name] || "";
    return span;
  }

  function rankByValueDesc(rows, key) {
    // Returns a Map row -> rank (1 = highest value = most pts allowed = easiest).
    var sorted = rows.slice().sort(function (a, b) {
      return b[key] - a[key];
    });
    var map = new Map();
    sorted.forEach(function (r, i) {
      map.set(r, i + 1);
    });
    return map;
  }

  function buildLogo(abbr) {
    var slug = ESPN_ABBR[abbr] || String(abbr).toLowerCase();
    var span = el("span", "fpa-app-logo");
    var img = document.createElement("img");
    img.src = "https://a.espncdn.com/i/teamlogos/nfl/500/" + slug + ".png";
    img.alt = abbr;
    img.loading = "lazy";
    img.width = 26;
    img.height = 26;
    img.addEventListener("error", function () {
      span.textContent = String(abbr).slice(0, 3);
      span.classList.add("fpa-app-logo--fallback");
    });
    span.appendChild(img);
    return span;
  }

  function fpaValue(row, pos) {
    return Number(row[pos + "Fpa"]);
  }

  function rankValue(row, pos, offRanks) {
    if (pos === "off") return offRanks.get(row);
    return Number(row[pos + "Rank"]);
  }

  function Widget(container) {
    this.container = container;
    this.format =
      container.getAttribute("data-format") || SDT_FPA.defaultFormat || "ppr";
    this.view =
      container.getAttribute("data-view") || SDT_FPA.defaultView || "adjusted";
    this.cache = {};
    this.current = null;
    // Sort state. Default: easiest overall defense first (highest OFF FPA).
    this.sortKey = "off";
    this.sortDir = "desc";
  }

  Widget.prototype.init = function () {
    this.render();
    this.load();
  };

  Widget.prototype.cacheKey = function () {
    return this.format + ":" + this.view;
  };

  // Build a response object for a combo from the data inlined into the page,
  // mirroring the shape the REST endpoint returns. Returns null if the inlined
  // snapshot is absent or doesn't contain this combo.
  Widget.prototype.fromInlineData = function (key) {
    var d =
      typeof SDT_FPA_DATA !== "undefined" && SDT_FPA_DATA ? SDT_FPA_DATA : null;
    if (!d || !d.combos || !d.combos[key]) return null;
    var combo = d.combos[key];
    var resp = {};
    for (var k in combo) {
      if (Object.prototype.hasOwnProperty.call(combo, k)) resp[k] = combo[k];
    }
    resp.available = true;
    resp.format = this.format;
    resp.view = this.view;
    resp.lastUpdated = d.generatedAt
      ? Math.floor(Date.parse(d.generatedAt) / 1000)
      : 0;
    return resp;
  };

  Widget.prototype.load = function () {
    var self = this;
    var key = this.cacheKey();
    if (this.cache[key]) {
      this.current = this.cache[key];
      this.renderTable();
      return;
    }

    // Prefer the snapshot inlined into the page — no network round-trip, and no
    // WordPress REST bootstrap. Fall back to the REST endpoint only if it's
    // missing (e.g. an aggressively cached page without the inline blob).
    var inlined = this.fromInlineData(key);
    if (inlined) {
      this.cache[key] = inlined;
      this.current = inlined;
      this.renderTable();
      return;
    }

    this.setLoading(true);
    var url =
      SDT_FPA.endpoint +
      (SDT_FPA.endpoint.indexOf("?") === -1 ? "?" : "&") +
      "format=" +
      encodeURIComponent(this.format) +
      "&view=" +
      encodeURIComponent(this.view);

    fetch(url, { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        self.cache[key] = data;
        self.current = data;
        self.renderTable();
      })
      .catch(function () {
        self.current = null;
        self.renderError();
      })
      .finally(function () {
        self.setLoading(false);
      });
  };

  Widget.prototype.setLoading = function (busy) {
    this.container.classList.toggle("fpa-app-is-loading", !!busy);
  };

  // ─── Rendering ──────────────────────────────────────────────────────────────

  Widget.prototype.render = function () {
    this.container.innerHTML = "";

    var panel = el("div", "fpa-app-panel");
    var self = this;

    // Row 1 — filters + export (CSV desktop only).
    var controls = el("div", "fpa-app-controls");
    controls.appendChild(this.buildGroup("Scoring", FORMAT_OPTS, "format"));
    controls.appendChild(this.buildGroup("View", VIEW_OPTS, "view", VIEW_TIP));

    var csvWrap = el("div", "fpa-app-csv-wrap");
    var csvBtn = el("button", "fpa-app-csv");
    csvBtn.type = "button";
    csvBtn.appendChild(icon("download", "fpa-app-icon--sm"));
    csvBtn.appendChild(el("span", null, "Export CSV"));
    csvBtn.addEventListener("click", function () {
      self.downloadCsv();
    });
    csvWrap.appendChild(csvBtn);
    controls.appendChild(csvWrap);
    panel.appendChild(controls);

    // Row 2 — model status chip + utility actions (Methodology, Scoring).
    panel.appendChild(this.buildMeta());

    this.container.appendChild(panel);

    // Mobile only: a copy of the baseline status sits directly above the table
    // (top-left). Hidden on desktop, where the panel's row-2 status shows.
    var statusMobile = this.buildStatus();
    statusMobile.classList.add("fpa-app-status--mobile");
    this.container.appendChild(statusMobile);

    // Table mount point.
    this.mount = el("div", "fpa-app-table-wrap");
    this.container.appendChild(this.mount);

    // Footer methodology line (populated from the data snapshot).
    this.footer = el("p", "fpa-app-methodology");
    this.footer.style.display = "none";
    this.container.appendChild(this.footer);
  };

  // "● Baseline Active  Preseason model" — the preseason-model status. Rendered
  // twice: inside the panel's row 2 (desktop) and directly above the table
  // (mobile only), so it stays visible where each layout reads best.
  Widget.prototype.buildStatus = function () {
    var status = el("div", "fpa-app-status");
    var chip = el("span", "fpa-app-status-chip");
    chip.appendChild(el("span", "fpa-app-status-dot"));
    chip.appendChild(document.createTextNode("Baseline Active"));
    status.appendChild(chip);
    status.appendChild(el("span", "fpa-app-meta-label", "Preseason model"));
    return status;
  };

  Widget.prototype.buildMeta = function () {
    var meta = el("div", "fpa-app-meta");

    // Status chip (hidden on mobile, where it moves above the table instead).
    meta.appendChild(this.buildStatus());

    // Utility actions (right side): Methodology + Scoring settings popovers.
    var actions = el("div", "fpa-app-meta-actions");
    actions.appendChild(this.buildMethodology());
    actions.appendChild(this.buildScoringSettings());
    meta.appendChild(actions);

    return meta;
  };

  // Consolidated Methodology popover: FPA + aFPA explanations plus the
  // preseason baseline schedule — replaces the old inline explainer rows.
  Widget.prototype.buildMethodology = function () {
    var wrap = el("div", "fpa-app-scoring fpa-app-pop--end");
    var btn = el("button", "fpa-app-util-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.appendChild(icon("info", "fpa-app-util-icon"));
    btn.appendChild(el("span", "fpa-app-util-label", "Methodology"));
    btn.appendChild(icon("chevron", "fpa-app-util-caret"));

    var body = el("div", "fpa-app-scoring-body");
    body.style.display = "none";

    var head = el("div", "fpa-app-scoring-head");
    head.appendChild(el("span", "fpa-app-scoring-title", "Methodology"));
    body.appendChild(head);

    body.appendChild(
      methSection("What are Fantasy Points Allowed?", FPA_EXPLAINER)
    );
    body.appendChild(
      methSection("What is Adjusted FPA (aFPA)?", AFPA_EXPLAINER)
    );

    var base = el("div", "fpa-app-scoring-group");
    base.appendChild(el("div", "fpa-app-meth-title", "Preseason baseline"));
    base.appendChild(
      el(
        "p",
        "fpa-app-meth-text",
        "Using 2025 full-season data until 2026 sample sizes become reliable."
      )
    );
    var schedule = [
      ["Preseason", "100% 2025 full season"],
      ["Weeks 1–4", "Blended baseline and 2026 data"],
      ["Week 5+", "Mostly current-season data"],
      ["Week 12+", "Rolling 10-week data"],
    ];
    var list = el("ul", "fpa-app-baseline-list");
    schedule.forEach(function (item) {
      var li = el("li", "fpa-app-baseline-item");
      li.appendChild(el("span", "fpa-app-baseline-bullet"));
      var text = el("span", "fpa-app-baseline-text");
      text.appendChild(el("span", "fpa-app-baseline-key", item[0] + ":"));
      text.appendChild(document.createTextNode(" " + item[1]));
      li.appendChild(text);
      list.appendChild(li);
    });
    base.appendChild(list);
    body.appendChild(base);

    wrap.appendChild(btn);
    wrap.appendChild(body);
    this.wirePopover(wrap, btn, body);
    return wrap;
  };

  // Shared popover wiring: toggle on click, close on outside click or Escape.
  Widget.prototype.wirePopover = function (wrap, btn, body) {
    function close() {
      body.style.display = "none";
      wrap.classList.remove("fpa-app-is-open");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeydown, true);
    }
    function onDocClick(e) {
      // The widget lives in a Shadow DOM, so a click inside it reaches this
      // document-level listener with e.target retargeted to the shadow host —
      // wrap.contains(e.target) would be false even for clicks inside the
      // popover and wrongly close it. composedPath() pierces the boundary and
      // lists the real nodes, so we test membership against that instead.
      var path = typeof e.composedPath === "function" ? e.composedPath() : null;
      var inside = path
        ? path.indexOf(wrap) !== -1
        : wrap.contains(e.target);
      if (!inside) close();
    }
    function onKeydown(e) {
      if (e.key === "Escape" || e.keyCode === 27) close();
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (body.style.display === "none") {
        body.style.display = "";
        wrap.classList.add("fpa-app-is-open");
        btn.setAttribute("aria-expanded", "true");
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKeydown, true);
      } else {
        close();
      }
    });
  };

  Widget.prototype.buildGroup = function (label, options, stateKey, tip) {
    var self = this;
    var group = el("div", "fpa-app-group");

    if (tip) {
      // Label + a small info icon carrying a native tooltip (matches the web
      // app's info affordance next to "View").
      var labelWrap = el("span", "fpa-app-label-wrap");
      labelWrap.appendChild(el("span", "fpa-app-label", label));
      var info = icon("info", "fpa-app-label-info");
      info.setAttribute("title", tip);
      labelWrap.appendChild(info);
      group.appendChild(labelWrap);
    } else {
      group.appendChild(el("span", "fpa-app-label", label));
    }

    var seg = el(
      "div",
      "fpa-app-segmented fpa-app-segmented--" +
        (options.length === 3 ? "three" : "two")
    );
    options.forEach(function (opt) {
      var btn = el("button", "fpa-app-chip", opt.label);
      btn.type = "button";
      if (self[stateKey] === opt.value) {
        btn.classList.add("fpa-app-is-active");
      }
      btn.addEventListener("click", function () {
        if (self[stateKey] === opt.value) return;
        self[stateKey] = opt.value;
        Array.prototype.forEach.call(seg.children, function (c) {
          c.classList.remove("fpa-app-is-active");
        });
        btn.classList.add("fpa-app-is-active");
        self.load();
        if (stateKey === "format") self.renderScoringRules();
      });
      seg.appendChild(btn);
    });
    group.appendChild(seg);
    return group;
  };

  Widget.prototype.buildScoringSettings = function () {
    // Floats as a popover anchored to its button so it never pushes the table
    // down. Closes on outside click or Escape, like the React Popover.
    var wrap = el("div", "fpa-app-scoring fpa-app-pop--end");
    var btn = el("button", "fpa-app-util-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.appendChild(icon("sliders", "fpa-app-util-icon"));
    btn.appendChild(el("span", "fpa-app-util-label", "Scoring settings"));
    btn.appendChild(icon("chevron", "fpa-app-util-caret"));
    var body = el("div", "fpa-app-scoring-body");
    body.style.display = "none";
    this.scoringBody = body;

    wrap.appendChild(btn);
    wrap.appendChild(body);
    this.wirePopover(wrap, btn, body);
    this.renderScoringRules();
    return wrap;
  };

  Widget.prototype.renderScoringRules = function () {
    if (!this.scoringBody) return;
    var fmt = this.format;
    var groups = [
      [
        "Passing",
        [
          ["Yards", "0.04 / yd"],
          ["Touchdown", "4"],
          ["Interception", "−1"],
          ["2-pt conversion", "2"],
        ],
      ],
      [
        "Rushing",
        [
          ["Yards", "0.1 / yd"],
          ["Touchdown", "6"],
          ["2-pt conversion", "2"],
        ],
      ],
      [
        "Receiving",
        [
          ["Reception", (RECEPTION_BY_FORMAT[fmt] || "1") + " / catch"],
          ["Yards", "0.1 / yd"],
          ["Touchdown", "6"],
          ["2-pt conversion", "2"],
        ],
      ],
      [
        "Misc",
        [
          ["Fumble lost", "−2"],
          ["Special-teams TD", "6"],
        ],
      ],
    ];

    var body = this.scoringBody;
    body.innerHTML = "";

    var head = el("div", "fpa-app-scoring-head");
    head.appendChild(el("span", "fpa-app-scoring-title", "Scoring rules"));
    head.appendChild(
      el("span", "fpa-app-scoring-badge", FORMAT_LABEL[fmt] || fmt)
    );
    body.appendChild(head);

    groups.forEach(function (g) {
      var grp = el("div", "fpa-app-scoring-group");
      grp.appendChild(el("div", "fpa-app-scoring-group-label", g[0]));
      g[1].forEach(function (item) {
        var isReception = item[0] === "Reception";
        var row = el(
          "div",
          "fpa-app-scoring-row" + (isReception ? " fpa-app-is-reception" : "")
        );
        row.appendChild(el("span", "fpa-app-scoring-key", item[0]));
        row.appendChild(el("span", "fpa-app-scoring-val", item[1]));
        grp.appendChild(row);
      });
      body.appendChild(grp);
    });

    body.appendChild(
      el(
        "div",
        "fpa-app-scoring-note",
        "Only the per-reception value changes with the selected scoring format."
      )
    );
  };

  Widget.prototype.renderError = function () {
    if (this.footer) this.footer.style.display = "none";
    this.mount.innerHTML = "";
    this.mount.appendChild(
      el(
        "div",
        "fpa-app-error",
        "Unable to load matchup data. Please try again later."
      )
    );
  };

  Widget.prototype.renderTable = function () {
    var data = this.current;
    this.mount.innerHTML = "";

    if (!data || data.available === false || !data.rows || !data.rows.length) {
      this.footer.style.display = "none";
      this.mount.appendChild(
        el(
          "div",
          "fpa-app-empty",
          (data && data.message) ||
            "No data available yet. Please check back soon."
        )
      );
      return;
    }

    // Footer methodology line — mirrors the web app's "Methodology · …" note.
    if (data.methodology) {
      this.footer.style.display = "";
      this.footer.innerHTML = "";
      this.footer.appendChild(
        el("span", "fpa-app-methodology-label", "Methodology")
      );
      this.footer.appendChild(
        document.createTextNode(" · " + data.methodology)
      );
    } else {
      this.footer.style.display = "none";
    }

    var self = this;
    var rows = data.rows.slice();
    var offRanks = rankByValueDesc(rows, "offFpa");

    this.sortRows(rows);

    var table = el("table", "fpa-app-table");
    var thead = el("thead");
    var htr = el("tr");

    var metric = data.view === "adjusted" ? "aFPA" : "FPA";
    var columns = [{ key: "team", label: "Team", cls: "fpa-app-th--team" }];
    POSITIONS.forEach(function (p) {
      columns.push({
        key: p.key,
        label: p.label,
        metric: metric,
        cls: "fpa-app-th--num" + (p.key === "off" ? " fpa-app-is-off" : ""),
      });
    });

    columns.forEach(function (col) {
      var th = el("th", "fpa-app-th fpa-app-th--sortable " + col.cls);
      var labelSpan = el("span", "fpa-app-th-label", col.label);
      // Keep the metric suffix as-is ("aFPA" / "FPA") so the header's
      // uppercase transform doesn't turn "aFPA" into "AFPA".
      if (col.metric) {
        labelSpan.appendChild(el("span", "fpa-app-th-metric", " " + col.metric));
      }
      th.appendChild(labelSpan);
      if (self.sortKey === col.key) {
        th.classList.add(
          self.sortDir === "asc" ? "fpa-app-is-sorted-asc" : "fpa-app-is-sorted-desc"
        );
        th.setAttribute(
          "aria-sort",
          self.sortDir === "asc" ? "ascending" : "descending"
        );
      } else {
        th.setAttribute("aria-sort", "none");
      }
      th.addEventListener("click", function () {
        self.onSort(col.key);
      });
      htr.appendChild(th);
    });

    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el("tbody");
    rows.forEach(function (row) {
      var tr = el("tr", "fpa-app-row");

      var teamTd = el("td", "fpa-app-td fpa-app-td--team");
      teamTd.appendChild(buildLogo(row.teamAbbr));
      var nameWrap = el("span", "fpa-app-team-name");
      nameWrap.appendChild(el("span", "fpa-app-abbr", row.teamAbbr));
      nameWrap.appendChild(el("span", "fpa-app-full", row.team));
      teamTd.appendChild(nameWrap);
      tr.appendChild(teamTd);

      POSITIONS.forEach(function (p) {
        var rank = rankValue(row, p.key, offRanks);
        var heat = tierHeat(rank);
        var td = el(
          "td",
          "fpa-app-td fpa-app-td--num " +
            heat +
            (p.key === "off" ? " fpa-app-is-off" : "")
        );
        td.textContent = fpaValue(row, p.key).toFixed(1);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    this.mount.appendChild(table);
  };

  Widget.prototype.sortRows = function (rows) {
    var key = this.sortKey;
    var mult = this.sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      if (key === "team") {
        return mult * String(a.team).localeCompare(String(b.team));
      }
      return mult * (Number(a[key + "Fpa"]) - Number(b[key + "Fpa"]));
    });
  };

  Widget.prototype.onSort = function (key) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortKey = key;
      // Names read best A→Z; FPA columns lead with the highest (easiest) first.
      this.sortDir = key === "team" ? "asc" : "desc";
    }
    this.renderTable();
  };

  Widget.prototype.downloadCsv = function () {
    var data = this.current;
    if (!data || !data.rows || !data.rows.length) {
      return;
    }
    var headers = [
      "Team",
      "QB FPA",
      "RB FPA",
      "WR FPA",
      "TE FPA",
      "OFF FPA",
    ];
    var lines = [headers.join(",")];
    data.rows.forEach(function (r) {
      lines.push(
        [
          '"' + String(r.team).replace(/"/g, '""') + '"',
          Number(r.qbFpa).toFixed(1),
          Number(r.rbFpa).toFixed(1),
          Number(r.wrFpa).toFixed(1),
          Number(r.teFpa).toFixed(1),
          Number(r.offFpa).toFixed(1),
        ].join(",")
      );
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download =
      "statchasers-fpa-" + this.format + "-" + this.view + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Apply the widget stylesheet INSIDE a shadow root and resolve once it's in
  // effect, so the caller can reveal the widget with no unstyled flash.
  //
  // Fast path: the CSS text is inlined into the page (SDT_FPA.cssText), so we
  // apply it SYNCHRONOUSLY — either as a constructable stylesheet adopted by the
  // shadow root, or as a plain <style> element. Both take effect immediately with
  // ZERO network round-trip, so the table (built synchronously) appears at once.
  //
  // Fallback: if no inline text is present (e.g. an aggressively cached page),
  // fetch the stylesheet over the network via a <link>, revealing once it loads
  // or after a short timeout so the reveal can never hang.
  function loadStyleInto(shadow) {
    var css = typeof SDT_FPA !== "undefined" ? SDT_FPA.cssText : "";
    if (css) {
      // Constructable stylesheet — cleanest, and shareable across instances.
      try {
        if ("adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype) {
          var sheet = new CSSStyleSheet();
          sheet.replaceSync(css);
          shadow.adoptedStyleSheets = shadow.adoptedStyleSheets.concat(sheet);
          return Promise.resolve();
        }
      } catch (e) {
        /* fall through to a <style> element */
      }
      var style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      var url = SDT_FPA.cssUrl;
      if (!url) {
        resolve();
        return;
      }
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = url;
      link.addEventListener("load", finish);
      link.addEventListener("error", finish);
      shadow.appendChild(link);
      // Never hang the reveal if load/error somehow never fires.
      setTimeout(finish, 1500);
    });
  }

  // Hydrate each shortcode host into an isolated Shadow DOM. WordPress/Divi
  // global CSS cannot cross the shadow boundary, so the widget renders exactly
  // as designed regardless of the surrounding theme.
  function boot() {
    var nodes = document.querySelectorAll("[data-fpa-app]");
    Array.prototype.forEach.call(nodes, function (host) {
      // Idempotent: a page builder may re-run scripts on the same node.
      if (host.shadowRoot || !host.attachShadow) return;

      var shadow = host.attachShadow({ mode: "open" });

      // All visual styling (incl. the container-query context) lives on this
      // wrapper inside the shadow root, not on the light-DOM host.
      var root = el("div", "fpa-app-root");
      var fmt = host.getAttribute("data-format");
      var view = host.getAttribute("data-view");
      if (fmt) root.setAttribute("data-format", fmt);
      if (view) root.setAttribute("data-view", view);

      // Hide until the stylesheet is in to avoid an unstyled flash.
      root.style.visibility = "hidden";
      root.appendChild(
        el(
          "div",
          "fpa-app-loading",
          "Loading Fantasy Points Allowed…"
        )
      );
      shadow.appendChild(root);

      loadStyleInto(shadow).then(function () {
        root.style.visibility = "";
      });

      var w = new Widget(root);
      w.init();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
