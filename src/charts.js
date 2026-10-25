/* MyWearIQ · charts.js — gráficas en canvas con cursor compartido.
   Canvas 2D propio, sin librerías. window.Charts */
(function (root) {
  'use strict';

  var M_LEFT = 44, M_RIGHT = 12, M_RIGHT_AXIS = 40, M_TOP = 6, M_BOTTOM_X = 22;

  /* ---- colores desde los tokens CSS (respetan el tema) ---- */
  function token(name) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || '').trim() || '#888';
  }
  function withAlpha(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return hex;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---- marcas de eje «números bonitos» (1-2-5-10) ---- */
  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [];
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = span / count / step;
    if (err >= 5) step *= 10; else if (err >= 2) step *= 5; else if (err >= 1) step *= 2;
    var out = [], v = Math.ceil(min / step) * step;
    for (; v <= max + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  /* ---- categorías WMO ---- */
  var SKY = [
    { codes: [0], label: 'Despejado', token: '--warn', a: 1 },
    { codes: [1, 2], label: 'Poco nuboso', token: '--warn', a: 0.55 },
    { codes: [3], label: 'Nublado', token: '--muted', a: 1 },
    { codes: [45, 48], label: 'Niebla', token: '--c-ele', a: 1 },
    { codes: [51, 53, 55, 56, 57], label: 'Llovizna', token: '--c-rain', a: 0.55 },
    { codes: [61, 63, 65, 66, 67], label: 'Lluvia', token: '--c-rain', a: 1 },
    { codes: [80, 81, 82], label: 'Chubascos', token: '--c-rain', a: 0.75 },
    { codes: [71, 73, 75, 77, 85, 86], label: 'Nieve', token: '--c-feel', a: 1 },
    { codes: [95, 96, 99], label: 'Tormenta', token: '--bad', a: 1 }
  ];
  function skyOf(code) {
    for (var i = 0; i < SKY.length; i++) {
      if (SKY[i].codes.indexOf(code) !== -1) return SKY[i];
    }
    return { codes: [], label: '—', token: '--muted', a: 0.3 };
  }

  var DEFS = [
    { id: 'sky', type: 'strip', title: 'Tiempo', h: 30 },
    { id: 'temp', type: 'line', title: 'Temperatura', unit: '°C', h: 118,
      series: [{ key: 'temp', label: 'Aire', token: '--c-temp' },
               { key: 'feel', label: 'Sensación', token: '--c-feel' }] },
    { id: 'wind', type: 'line', title: 'Viento', unit: 'km/h', h: 118,
      series: [{ key: 'wind', label: 'Velocidad', token: '--c-wind' },
               { key: 'gust', label: 'Rachas', token: '--c-wind', dash: [1, 3] },
               { key: 'headwind', label: 'Cara/cola', token: '--accent', thin: true, optional: true }] },
    { id: 'rain', type: 'bar', title: 'Lluvia', unit: 'mm/h', h: 118, right: { key: 'prob', label: '%' },
      series: [{ key: 'precip', label: 'mm/h', token: '--c-rain', bar: true }],
      line2: { key: 'prob', label: '% prob.', token: '--accent', dash: [4, 3] } },
    { id: 'ele', type: 'line', title: 'Altitud', unit: 'm', h: 96, optional: true,
      series: [{ key: 'ele', label: 'Altitud', token: '--c-ele', fill: true }] }
  ];

  function fmtNum(v, dec) {
    if (v == null || !isFinite(v)) return '—';
    return dec ? v.toFixed(dec) : String(Math.round(v));
  }
  function hhmm(min) {
    var d = new Date(Math.round(min) * 60000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  /* --------------------------------------------------------------- */
  function create(container, opts) {
    opts = opts || {};
    var state = null, blocks = [], raf = 0;

    function build() {
      container.textContent = '';
      blocks = DEFS.map(function (def) {
        var wrap = document.createElement('div');
        wrap.className = 'chart';
        var head = document.createElement('div');
        head.className = 'chart-head';
        var title = document.createElement('span');
        title.className = 'chart-title';
        title.textContent = def.title + (def.unit ? ' (' + def.unit + ')' : '');
        head.appendChild(title);
        var legend = document.createElement('span');
        legend.className = 'chart-legend';
        head.appendChild(legend);
        var cv = document.createElement('canvas');
        cv.className = 'chart-cv';
        cv.style.touchAction = 'pan-y';
        wrap.appendChild(head);
        wrap.appendChild(cv);
        container.appendChild(wrap);
        var b = { def: def, wrap: wrap, canvas: cv, legend: legend, ctx: cv.getContext('2d') };
        bindPointer(b);
        return b;
      });
    }

    function bindPointer(b) {
      function pick(ev) {
        if (!state || !state.series || !state.series.length) return;
        var rect = b.canvas.getBoundingClientRect();
        var x = (ev.clientX - rect.left);
        var g = geometry(b, rect.width);
        if (x < g.l || x > g.w - g.r) return;
        var dom = xDomain();
        var xv = dom[0] + (x - g.l) / (g.w - g.l - g.r) * (dom[1] - dom[0]);
        var best = 0, bd = Infinity;
        for (var i = 0; i < state.series.length; i++) {
          var d = Math.abs(xAt(state.series[i], state.xMode) - xv);
          if (d < bd) { bd = d; best = i; }
        }
        if (opts.onCursor) opts.onCursor(best);
      }
      b.canvas.addEventListener('pointermove', pick);
      b.canvas.addEventListener('pointerdown', function (ev) { pick(ev); });
    }

    function xAt(s, mode) { return mode === 'time' ? (s.t || 0) : (s.dist != null ? s.dist : 0); }

    function geometry(b, cssW) {
      var hasRight = !!(b.def.right && b.def.rightOn !== false);
      return {
        w: cssW, h: b.def.h,
        l: M_LEFT, r: hasRight ? M_RIGHT_AXIS : M_RIGHT,
        t: M_TOP, b: M_BOTTOM_X,
        x0: 0, x1: 1, hasRight: hasRight
      };
    }

    function xDomain() {
      if (!state || !state.series || !state.series.length) return [0, 1];
      if (state.xMode === 'time') {
        var tmax = state.series[state.series.length - 1].t || 0;
        return [0, Math.max(tmax, 1)];
      }
      if (state.hasKm) {
        var dmax = state.series[state.series.length - 1].dist || 0;
        return [0, Math.max(dmax, 0.001)];
      }
      return [0, 1];
    }

    function xTicks() {
      var dom = xDomain();
      if (state.xMode === 'time' || !state.hasKm) {
        var dur = dom[1];
        var step = dur > 360 ? 60 : 30;
        var out = [];
        for (var v = 0; v <= dur + 0.001; v += step) out.push({ v: v, label: hhmm((state.departureMin || 0) + v) });
        if (out.length < 2) out = [{ v: 0, label: hhmm(state.departureMin || 0) }, { v: dur, label: hhmm((state.departureMin || 0) + dur) }];
        return out;
      }
      return niceTicks(dom[0], dom[1], 5).map(function (v) {
        var dec = dom[1] < 20 ? 1 : 0;
        return { v: v, label: fmtNum(v, dec) };
      });
    }

    function yDomain(b) {
      var lo = Infinity, hi = -Infinity;
      b.def.series.forEach(function (se) {
        if (se.optional && !hasSeries(se.key)) return;
        state.series.forEach(function (s) {
          var v = s[se.key];
          if (v == null || !isFinite(v)) return;
          if (v < lo) lo = v; if (v > hi) hi = v;
        });
      });
      if (b.def.type === 'bar' || b.def.line2) {
        state.series.forEach(function (s) {
          var v = s.precip;
          if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
        });
      }
      if (b.def.type === 'strip') return [0, 1];
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      if (lo === hi) { lo -= 1; hi += 1; }
      var pad = (hi - lo) * 0.1;
      return [lo - pad, hi + pad];
    }
    function hasSeries(key) {
      if (!state || !state.series) return false;
      return state.series.some(function (s) { return s[key] != null && isFinite(s[key]); });
    }

    function fitCanvas(b) {
      var dpr = root.devicePixelRatio || 1;
      var cssW = b.wrap.clientWidth || 320;
      var cssH = b.def.h;
      if (b.canvas.width !== Math.round(cssW * dpr) || b.canvas.height !== Math.round(cssH * dpr)) {
        b.canvas.width = Math.round(cssW * dpr);
        b.canvas.height = Math.round(cssH * dpr);
        b.canvas.style.width = cssW + 'px';
        b.canvas.style.height = cssH + 'px';
      }
      b.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.ctx.clearRect(0, 0, cssW, cssH);
      return cssW;
    }

    function drawAll() {
      if (!state) return;
      blocks.forEach(function (b) {
        if (b.def.id === 'ele' && !hasSeries('ele')) { b.wrap.style.display = 'none'; return; }
        b.wrap.style.display = '';
      });
      var vis = blocks.filter(function (x) { return x.wrap.style.display !== 'none'; });
      var last = vis.length ? vis[vis.length - 1] : null;
      vis.forEach(function (b) { draw(b, b === last); });
    }

    function draw(b, withXAxis) {
      var cssW = fitCanvas(b);
      var ctx = b.ctx;
      var g = geometry(b, cssW);
      var dom = xDomain();
      var isStrip = b.def.type === 'strip';
      var yd = isStrip ? [0, 1] : yDomain(b);
      var plotW = g.w - g.l - g.r;
      var plotH = g.h - g.t - (withXAxis ? g.b : 4);
      function X(v) { return g.l + (v - dom[0]) / (dom[1] - dom[0] || 1) * plotW; }
      function Y(v) { return g.t + plotH - (v - yd[0]) / (yd[1] - yd[0] || 1) * plotH; }

      var ink = token('--ink'), muted = token('--muted'), line = token('--line');
      ctx.font = '11px Barlow, system-ui, sans-serif';
      ctx.textBaseline = 'middle';

      if (isStrip) { drawStrip(b, ctx, X, g, plotW, plotH, dom); }
      else {
        /* rejilla + eje y izquierdo */
        var ticks = niceTicks(yd[0], yd[1], 4);
        ctx.strokeStyle = line; ctx.fillStyle = muted;
        ctx.lineWidth = 1;
        ticks.forEach(function (v) {
          var y = Math.round(Y(v)) + 0.5;
          if (y < g.t - 1 || y > g.t + plotH + 1) return;
          ctx.beginPath(); ctx.moveTo(g.l, y); ctx.lineTo(g.l + plotW, y); ctx.stroke();
          ctx.textAlign = 'right';
          ctx.fillText(fmtNum(v, Math.abs(yd[1] - yd[0]) < 6 ? 1 : 0), g.l - 6, y);
        });
        /* eje derecho */
        if (g.hasRight) {
          ctx.fillStyle = muted; ctx.textAlign = 'left';
          [0, 50, 100].forEach(function (v) {
            var y = Math.round(g.t + plotH - v / 100 * plotH) + 0.5;
            ctx.fillText(String(v), g.l + plotW + 6, y);
          });
        }
        ctx.strokeStyle = line;
        ctx.beginPath();
        ctx.moveTo(g.l + 0.5, g.t); ctx.lineTo(g.l + 0.5, g.t + plotH);
        ctx.lineTo(g.l + plotW + 0.5, g.t + plotH + 0.5);
        ctx.stroke();

        if (b.def.type === 'bar') drawBars(b, ctx, X, Y, g, plotH);
        b.def.series.forEach(function (se) {
          if (se.optional && !hasSeries(se.key)) return;
          drawSeries(ctx, se, X, Y, g, plotH, token(se.token));
        });
        if (b.def.line2 && hasSeries(b.def.line2.key)) drawLine2(b, ctx, X, g, plotH);
      }

      /* cursor compartido */
      if (state.cursor != null && state.series[state.cursor]) {
        var s = state.series[state.cursor];
        var cx = Math.round(X(xAt(s, state.xMode))) + 0.5;
        if (cx >= g.l && cx <= g.l + plotW) {
          ctx.strokeStyle = ink; ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(cx, g.t); ctx.lineTo(cx, g.t + plotH); ctx.stroke();
          ctx.setLineDash([]);
          if (!isStrip) {
            (b.def.series || []).forEach(function (se) {
              if (se.optional && !hasSeries(se.key)) return;
              var v = s[se.key];
              if (v == null || !isFinite(v)) return;
              ctx.fillStyle = token(se.token);
              ctx.beginPath(); ctx.arc(cx, Y(v), 3, 0, Math.PI * 2); ctx.fill();
              ctx.strokeStyle = token('--surface'); ctx.lineWidth = 1.5; ctx.stroke();
            });
          }
        }
      }

      /* eje X (solo la última gráfica visible) */
      if (withXAxis) {
        ctx.fillStyle = muted; ctx.strokeStyle = line;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        var y = g.t + plotH + 6;
        ctx.beginPath(); ctx.moveTo(g.l, y - 3.5); ctx.lineTo(g.l + plotW, y - 3.5); ctx.stroke();
        xTicks().forEach(function (t) {
          var x = X(t.v);
          if (x < g.l - 1 || x > g.l + plotW + 1) return;
          ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y - 6); ctx.lineTo(Math.round(x) + 0.5, y - 3); ctx.stroke();
          ctx.fillText(t.label, x, y);
        });
      }
    }

    function drawStrip(b, ctx, X, g, plotW, plotH, dom) {
      var ser = state.series;
      var n = ser.length;
      ctx.fillStyle = token('--sunken');
      ctx.fillRect(g.l, g.t, plotW, plotH);
      for (var i = 0; i < n; i++) {
        var x0 = X(xAt(ser[i], state.xMode));
        var x1 = i < n - 1 ? X(xAt(ser[i + 1], state.xMode)) : x0 + (plotW / Math.max(n - 1, 1));
        if (i === 0 && state.xMode !== 'time' && state.hasKm) x0 = g.l;
        var cat = skyOf(ser[i].code);
        ctx.fillStyle = withAlpha(token(cat.token), cat.a);
        ctx.fillRect(x0, g.t, Math.max(x1 - x0, 1), plotH);
      }
      /* rótulos solo si caben */
      ctx.fillStyle = token('--ink');
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (var j = 0; j < n; j++) {
        var a0 = X(xAt(ser[j], state.xMode));
        var a1 = j < n - 1 ? X(xAt(ser[j + 1], state.xMode)) : a0;
        var w = a1 - a0;
        if (w < 4) continue;
        var label = skyOf(ser[j].code).label;
        if (ctx.measureText(label).width + 8 > w) continue;
        ctx.fillText(label, (a0 + a1) / 2, g.t + plotH / 2);
      }
    }

    function drawSeries(ctx, se, X, Y, g, plotH, color) {
      var ser = state.series;
      if (se.bar) return; /* las barras se pintan aparte */
      ctx.strokeStyle = color;
      ctx.lineWidth = se.thin ? 1.5 : 2;
      ctx.setLineDash(se.dash || []);
      ctx.lineJoin = 'round';
      if (se.fill) {
        ctx.beginPath();
        var started = false, lastX = 0;
        ser.forEach(function (s, i) {
          var v = s[se.key];
          if (v == null || !isFinite(v)) return;
          var x = X(xAt(s, state.xMode)), y = Y(v);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
          lastX = x;
        });
        if (started) {
          var base = Y(Math.max(0, 0));
          ctx.lineTo(lastX, base); ctx.lineTo(g.l, base); ctx.closePath();
          ctx.fillStyle = withAlpha(color, 0.15); ctx.fill();
        }
        ctx.beginPath();
        started = false;
        ser.forEach(function (s) {
          var v = s[se.key];
          if (v == null || !isFinite(v)) return;
          var x = X(xAt(s, state.xMode)), y = Y(v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      } else {
        ctx.beginPath();
        var ok = false;
        ser.forEach(function (s) {
          var v = s[se.key];
          if (v == null || !isFinite(v)) { ok = false; return; }
          var x = X(xAt(s, state.xMode)), y = Y(v);
          if (!ok) { ctx.moveTo(x, y); ok = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    function drawBars(b, ctx, X, Y, g, plotH) {
      var ser = state.series, color = token('--c-rain');
      var base = Y(Math.max(0, 0));
      for (var i = 0; i < ser.length; i++) {
        var v = ser[i].precip;
        if (v == null || !isFinite(v) || v <= 0) continue;
        var x0 = X(xAt(ser[i], state.xMode));
        var x1 = i < ser.length - 1 ? X(xAt(ser[i + 1], state.xMode)) : x0 + 6;
        var w = Math.max(Math.min(x1 - x0, 24) - 2, 2);
        var y = Y(v);
        ctx.fillStyle = color;
        ctx.fillRect(x0 + 1, Math.min(y, base), w, Math.abs(base - y));
      }
    }

    function drawLine2(b, ctx, X, g, plotH) {
      var ser = state.series, color = token(b.def.line2.token);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.setLineDash(b.def.line2.dash || []);
      ctx.beginPath();
      var ok = false;
      ser.forEach(function (s) {
        var v = s[b.def.line2.key];
        if (v == null || !isFinite(v)) { ok = false; return; }
        var x = X(xAt(s, state.xMode));
        var y = g.t + plotH - (v / 100) * plotH;
        if (!ok) { ctx.moveTo(x, y); ok = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    function updateLegend() {
      blocks.forEach(function (b) {
        var parts = [];
        (b.def.series || []).forEach(function (se) {
          if (se.optional && !hasSeries(se.key)) return;
          if (b.def.type === 'strip') return;
          parts.push('<i style="background:' + token(se.token) + (se.dash ? ';opacity:.75' : '') + '"></i>' + se.label);
        });
        if (b.def.line2 && hasSeries(b.def.line2.key)) {
          parts.push('<i style="background:' + token(b.def.line2.token) + '"></i>' + b.def.line2.label + ' (eje drcho.)');
        }
        b.legend.innerHTML = parts.join('');
      });
    }

    function scheduleDraw() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; drawAll(); });
    }

    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(scheduleDraw);
      ro.observe(container);
    }

    return {
      update: function (st) {
        state = st;
        if (!blocks.length) build();
        updateLegend();
        drawAll();
      },
      setCursor: function (i) {
        if (!state) return;
        state.cursor = i;
        scheduleDraw();
      },
      destroy: function () { if (ro) ro.disconnect(); container.textContent = ''; blocks = []; }
    };
  }

  root.Charts = { create: create, niceTicks: niceTicks, skyOf: skyOf };
})(typeof self !== 'undefined' ? self : this);
