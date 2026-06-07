/* global SDT_FPA */
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

  // Rank 1 = easiest (most pts allowed). Rank 32 = toughest (fewest allowed).
  function tierHeat(rank) {
    if (rank <= 8) return "sdt-heat--smash"; // light green (easiest)
    if (rank <= 16) return ""; // white
    if (rank <= 24) return "sdt-heat--good"; // pale yellow
    return "sdt-heat--tough"; // light red (toughest)
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
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
    var span = el("span", "sdt-fpa__logo");
    var img = document.createElement("img");
    img.src = "https://a.espncdn.com/i/teamlogos/nfl/500/" + slug + ".png";
    img.alt = abbr;
    img.loading = "lazy";
    img.width = 26;
    img.height = 26;
    img.addEventListener("error", function () {
      span.textContent = String(abbr).slice(0, 3);
      span.classList.add("sdt-fpa__logo--fallback");
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
  }

  Widget.prototype.init = function () {
    this.render();
    this.load();
  };

  Widget.prototype.cacheKey = function () {
    return this.format + ":" + this.view;
  };

  Widget.prototype.load = function () {
    var self = this;
    var key = this.cacheKey();
    if (this.cache[key]) {
      this.current = this.cache[key];
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
    this.container.classList.toggle("is-loading", !!busy);
  };

  // ─── Rendering ──────────────────────────────────────────────────────────────

  Widget.prototype.render = function () {
    this.container.innerHTML = "";

    var panel = el("div", "sdt-fpa__panel");

    // Controls: Scoring + View segmented groups, CSV (desktop only).
    var controls = el("div", "sdt-fpa__controls");
    controls.appendChild(this.buildGroup("Scoring", FORMAT_OPTS, "format"));
    controls.appendChild(this.buildGroup("View", VIEW_OPTS, "view"));

    var csvWrap = el("div", "sdt-fpa__csv-wrap");
    var csvBtn = el("button", "sdt-fpa__csv", "↓ Download CSV");
    csvBtn.type = "button";
    var self = this;
    csvBtn.addEventListener("click", function () {
      self.downloadCsv();
    });
    csvWrap.appendChild(csvBtn);
    controls.appendChild(csvWrap);

    panel.appendChild(controls);

    // Notice (StatChasers blue).
    this.notice = el("div", "sdt-fpa__notice");
    panel.appendChild(this.notice);

    this.container.appendChild(panel);

    // Table mount point.
    this.mount = el("div", "sdt-fpa__table-wrap");
    this.container.appendChild(this.mount);
  };

  Widget.prototype.buildGroup = function (label, options, stateKey) {
    var self = this;
    var group = el("div", "sdt-fpa__group");
    group.appendChild(el("span", "sdt-fpa__label", label));

    var seg = el(
      "div",
      "sdt-fpa__segmented sdt-fpa__segmented--" +
        (options.length === 3 ? "three" : "two")
    );
    options.forEach(function (opt) {
      var btn = el("button", "sdt-fpa__chip", opt.label);
      btn.type = "button";
      if (self[stateKey] === opt.value) {
        btn.classList.add("is-active");
      }
      btn.addEventListener("click", function () {
        if (self[stateKey] === opt.value) return;
        self[stateKey] = opt.value;
        Array.prototype.forEach.call(seg.children, function (c) {
          c.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        self.load();
      });
      seg.appendChild(btn);
    });
    group.appendChild(seg);
    return group;
  };

  Widget.prototype.renderError = function () {
    this.mount.innerHTML = "";
    this.mount.appendChild(
      el(
        "div",
        "sdt-fpa__error",
        "Unable to load matchup data. Please try again later."
      )
    );
  };

  Widget.prototype.renderTable = function () {
    var data = this.current;
    this.mount.innerHTML = "";

    if (!data || data.available === false || !data.rows || !data.rows.length) {
      this.notice.style.display = "none";
      this.mount.appendChild(
        el(
          "div",
          "sdt-fpa__empty",
          (data && data.message) ||
            "No data available yet. Please check back soon."
        )
      );
      return;
    }

    // Notice text.
    this.notice.style.display = "";
    this.notice.innerHTML = "";
    var dot = el("span", "sdt-fpa__notice-dot");
    var strong = el(
      "span",
      "sdt-fpa__notice-strong",
      (data.dataMode || "Preseason Baseline") + ":"
    );
    var rest = el(
      "span",
      "sdt-fpa__notice-text",
      " " +
        (data.methodology ||
          "Using prior full-season data until current-season sample sizes become reliable.")
    );
    this.notice.appendChild(dot);
    this.notice.appendChild(strong);
    this.notice.appendChild(rest);

    var rows = data.rows.slice();
    var offRanks = rankByValueDesc(rows, "offFpa");

    // Default sort: easiest overall defense first (highest OFF FPA).
    rows.sort(function (a, b) {
      return b.offFpa - a.offFpa;
    });

    var table = el("table", "sdt-fpa__table");
    var thead = el("thead");
    var htr = el("tr");
    htr.appendChild(el("th", "sdt-fpa__th sdt-fpa__th--team", "Team"));
    POSITIONS.forEach(function (p) {
      htr.appendChild(
        el(
          "th",
          "sdt-fpa__th sdt-fpa__th--num" + (p.key === "off" ? " is-off" : ""),
          p.label + " " + (data.view === "adjusted" ? "aFPA" : "FPA")
        )
      );
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el("tbody");
    rows.forEach(function (row) {
      var tr = el("tr", "sdt-fpa__row");

      var teamTd = el("td", "sdt-fpa__td sdt-fpa__td--team");
      teamTd.appendChild(buildLogo(row.teamAbbr));
      var nameWrap = el("span", "sdt-fpa__team-name");
      nameWrap.appendChild(el("span", "sdt-fpa__abbr", row.teamAbbr));
      nameWrap.appendChild(el("span", "sdt-fpa__full", row.team));
      teamTd.appendChild(nameWrap);
      tr.appendChild(teamTd);

      POSITIONS.forEach(function (p) {
        var rank = rankValue(row, p.key, offRanks);
        var heat = tierHeat(rank);
        var td = el(
          "td",
          "sdt-fpa__td sdt-fpa__td--num " +
            heat +
            (p.key === "off" ? " is-off" : "")
        );
        td.textContent = fpaValue(row, p.key).toFixed(1);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    this.mount.appendChild(table);
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

  function boot() {
    var nodes = document.querySelectorAll("[data-sdt-fpa]");
    Array.prototype.forEach.call(nodes, function (node) {
      var w = new Widget(node);
      w.init();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
