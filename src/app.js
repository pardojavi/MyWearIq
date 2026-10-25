/* MyWearIQ · app.js — estado, eventos y pintado.
   Conecta domain.js, rules.js, services.js, charts.js y Leaflet. */
(function () {
  'use strict';

  var D = window.Domain, R = window.ClothingRules, S = window.Services;
  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v, dec) {
    if (v == null || !isFinite(v)) return '—';
    var s = dec ? Number(v).toFixed(dec) : String(Math.round(v));
    return s.replace('.', ',');
  }
  function dur(min) {
    if (min == null || !isFinite(min)) return '—';
    var h = Math.floor(min / 60), m = Math.round(min - h * 60);
    if (m === 60) { h++; m = 0; }
    return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
  }
  function durShort(min) {
    var h = Math.floor(min / 60), m = Math.round(min - h * 60);
    if (m === 60) { h++; m = 0; }
    return h + ' h ' + (m < 10 ? '0' : '') + m;
  }

  /* ---------------- estado ---------------- */
  var st = {
    mode: 'track',
    origin: null, dest: null, track: null, samples: null,
    series: null, stats: null, rec: null, profiles: null,
    hourlies: null,
    departureMin: null, arrivalMin: null, windowMin: null,
    totalKm: null, hasEle: false, up: 0, down: 0,
    hasBearing: false, xMode: 'km', colorby: 'feel', cursor: 0,
    demo: false, busy: false
  };

  /* ---------------- tema ---------------- */
  function readStored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeStored(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(readStored('mwiq:theme'));
  $('theme').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var isDark = cur ? cur === 'dark'
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = isDark ? 'light' : 'dark';
    applyTheme(next);
    writeStored('mwiq:theme', next);
    renderMap();
    renderCharts();
  });

  /* ---------------- mensajes ---------------- */
  function msg(text, kind) {
    var el = $('msg');
    el.textContent = text || '';
    el.className = kind || '';
  }

  /* ---------------- mapa ---------------- */
  var map = null, layerRoute = null, layerMarks = null;
  var SCALES = {
    feel: {
      key: 'feel', name: 'Sensación térmica', unit: '°C',
      stops: [[-5, '#2B4F9E'], [5, '#3B8FC4'], [12, '#5DB7A5'], [18, '#E0C14A'], [25, '#E8893A'], [32, '#C8452B']],
      caps: ['-5°', '32°']
    },
    rain: {
      key: 'precip', name: 'Lluvia', unit: 'mm/h',
      stops: [[0, '#9AA7B2'], [0.3, '#6AA2E8'], [1, '#2A73D6'], [3, '#1B3FA0']],
      caps: ['0', '3 mm/h']
    },
    headwind: {
      key: 'headwind', name: 'Viento de cara', unit: 'km/h',
      stops: [[-20, '#2E9E6B'], [0, '#AAB5BD'], [20, '#C8452B']],
      caps: ['−20 de cola', '20 de cara']
    }
  };
  function hexRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function scaleColor(scale, v) {
    if (v == null || !isFinite(v)) return '#8A98A3';
    var s = scale.stops;
    if (v <= s[0][0]) return s[0][1];
    for (var i = 1; i < s.length; i++) {
      if (v <= s[i][0]) {
        var f = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0] || 1);
        var a = hexRgb(s[i - 1][1]), b = hexRgb(s[i][1]);
        return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' +
          Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
          Math.round(a[2] + (b[2] - a[2]) * f) + ')';
      }
    }
    return s[s.length - 1][1];
  }
  function cssToken(name) {
    return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim();
  }

  function initMap() {
    if (typeof L === 'undefined') return; /* se ve el texto de reserva */
    $('map').textContent = '';
    map = L.map('map', { zoomControl: true }).setView([40.2, -3.7], 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '© colaboradores de OpenStreetMap'
    }).addTo(map);
    layerRoute = L.layerGroup().addTo(map);
    layerMarks = L.layerGroup().addTo(map);
    map.on('click', function (e) {
      if (st.mode !== 'place') return;
      setOrigin(e.latlng.lat, e.latlng.lng, 'Punto marcado en el mapa');
    });
  }

  function clearLayers() {
    if (layerRoute) layerRoute.clearLayers();
    if (layerMarks) layerMarks.clearLayers();
  }

  function renderMap() {
    if (!map || !st.series) return;
    clearLayers();
    var ser = st.series;
    var scale = SCALES[st.colorby] || SCALES.feel;
    var n = ser.length;
    if (n > 1) {
      for (var i = 0; i < n - 1; i++) {
        var v = scale.key === 'headwind'
          ? ((ser[i].headwind != null && ser[i + 1].headwind != null)
            ? (ser[i].headwind + ser[i + 1].headwind) / 2 : null)
          : ser[i][scale.key];
        L.polyline([[ser[i].lat, ser[i].lon], [ser[i + 1].lat, ser[i + 1].lon]], {
          color: scaleColor(scale, v), weight: 5, opacity: 0.95, lineCap: 'round'
        }).addTo(layerRoute);
      }
    }
    var start = ser[0], end = ser[n - 1];
    L.circleMarker([start.lat, start.lon], {
      radius: 7, color: cssToken('--surface') || '#fff', weight: 2,
      fillColor: cssToken('--good') || '#23824F', fillOpacity: 1
    }).addTo(layerMarks).bindTooltip('Salida');
    if (n > 1 && (end.lat !== start.lat || end.lon !== start.lon)) {
      L.circleMarker([end.lat, end.lon], {
        radius: 7, color: cssToken('--surface') || '#fff', weight: 2,
        fillColor: cssToken('--bad') || '#BE3A34', fillOpacity: 1
      }).addTo(layerMarks).bindTooltip('Llegada');
    }
    L.circleMarker([start.lat, start.lon], {
      radius: 5, color: cssToken('--accent') || '#0A6B88', weight: 2,
      fillColor: cssToken('--surface') || '#fff', fillOpacity: 0.9, className: 'cursor-dot'
    }).addTo(layerMarks);

    if (n > 1) {
      var b = L.latLngBounds(ser.map(function (s) { return [s.lat, s.lon]; }));
      map.fitBounds(b, { padding: [22, 22], maxZoom: 14 });
    } else {
      map.setView([start.lat, start.lon], 11);
    }
    moveCursorMarker();
    renderLegend(scale);
  }

  function moveCursorMarker() {
    if (!map || !st.series || !layerMarks) return;
    layerMarks.eachLayer(function (ly) {
      if (ly.options && ly.options.className === 'cursor-dot') {
        var s = st.series[st.cursor];
        if (s) ly.setLatLng([s.lat, s.lon]);
      }
    });
  }

  function renderLegend(scale) {
    var grad = 'linear-gradient(90deg,' + scale.stops.map(function (s, i) {
      return s[1] + ' ' + (i / (scale.stops.length - 1) * 100).toFixed(1) + '%';
    }).join(',') + ')';
    $('legend').innerHTML =
      '<span class="cap">' + esc(scale.caps[0]) + '</span>' +
      '<span class="grad" style="background:' + grad + '"></span>' +
      '<span class="cap">' + esc(scale.caps[1]) + '</span>';
  }

  /* ---------------- geolocalización y búsqueda ---------------- */
  function setOrigin(lat, lon, label) {
    st.origin = { lat: lat, lon: lon, label: label };
    var el = st.mode === 'here' ? $('here-info') : $('place-info');
    el.textContent = label + ' · ' + num(lat, 4) + ', ' + num(lon, 4);
    el.className = 'hint ok';
  }
  function setDest(lat, lon, label) {
    st.dest = { lat: lat, lon: lon, label: label };
    $('dest-info').textContent = label + ' · ' + num(lat, 4) + ', ' + num(lon, 4);
    $('dest-info').className = 'hint ok';
  }

  $('locate').addEventListener('click', function () {
    if (!navigator.geolocation) {
      msg('Este navegador no permite la geolocalización. Elige un lugar o carga un track.', 'err');
      return;
    }
    msg('Buscando tu ubicación…', 'ok');
    navigator.geolocation.getCurrentPosition(function (pos) {
      setOrigin(pos.coords.latitude, pos.coords.longitude, 'Mi ubicación');
      msg('Ubicación encontrada.', 'ok');
    }, function () {
      msg('No se ha podido obtener tu ubicación. Elige un lugar o carga un track GPX.', 'err');
    }, { timeout: 15000, maximumAge: 300000 });
  });

  function wireSearch(inputId, goId, listId, infoId, done) {
    var input = $(inputId), go = $(goId), list = $(listId), info = $(infoId);
    function run() {
      var q = input.value.trim();
      if (!q) { info.textContent = ''; list.textContent = ''; return; }
      info.textContent = 'Buscando…'; info.className = 'hint';
      list.textContent = '';
      S.geocode(q).then(function (rs) {
        if (!rs.length) { info.textContent = 'Sin resultados para «' + q + '».'; info.className = 'hint err'; return; }
        info.textContent = 'Elige un resultado:'; info.className = 'hint';
        rs.forEach(function (r) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          var sub = [r.admin1, r.country].filter(Boolean).join(' · ');
          b.innerHTML = esc(r.name) + (sub ? '<span class="sub2">' + esc(sub) + '</span>' : '');
          b.addEventListener('click', function () {
            done(r.latitude, r.longitude, r.name + (sub ? ' (' + sub + ')' : ''));
            list.textContent = '';
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }).catch(function (e) {
        info.textContent = e && e.message ? e.message : 'Error de búsqueda.';
        info.className = 'hint err';
      });
    }
    go.addEventListener('click', run);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); run(); }
    });
  }
  wireSearch('place-q', 'place-go', 'place-results', 'place-info', setOrigin);
  wireSearch('dest-q', 'dest-go', 'dest-results', 'dest-info', setDest);

  /* ---------------- track GPX ---------------- */
  function loadTrackText(text, name) {
    var pts = D.parseGpx(text);
    var tr = D.buildTrack(pts);
    st.track = tr;
    var info = name ? name + ' · ' : '';
    info += tr.pts.length + ' puntos · ' + num(tr.totalKm, 1) + ' km';
    info += tr.hasEle
      ? ' · desnivel +' + Math.round(tr.up) + ' / −' + Math.round(tr.down) + ' m'
      : ' · sin altitud (la usará la previsión)';
    $('track-info').textContent = info;
    $('track-info').className = 'hint ok';
    return tr;
  }
  $('gpx').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        loadTrackText(String(fr.result), f.name);
        msg('Track cargado.', 'ok');
      } catch (e) {
        st.track = null;
        $('track-info').textContent = 'No se ha podido leer el archivo.';
        $('track-info').className = 'hint err';
        msg(e && e.message ? e.message : 'GPX no válido.', 'err');
      }
    };
    fr.onerror = function () { msg('No se ha podido leer el archivo.', 'err'); };
    fr.readAsText(f);
  });

  /* ---------------- modo y opciones ---------------- */
  function setMode(mode) {
    st.mode = mode;
    Array.prototype.forEach.call(document.querySelectorAll('.seg [data-mode]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-mode') === mode);
    });
    $('pane-here').hidden = mode !== 'here';
    $('pane-place').hidden = mode !== 'place';
    $('pane-track').hidden = mode !== 'track';
    syncOptions();
    msg('');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.seg [data-mode]'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });

  function syncOptions() {
    var track = st.mode === 'track';
    var circ = $('circular').checked;
    var showRoute = !track && !circ;
    $('dest-wrap').hidden = !showRoute;
    $('dur-wrap').hidden = !showRoute;
    $('speed-wrap').hidden = !track;
    $('ret-label').textContent = track ? 'Hora de llegada (opcional)' : 'Hora de vuelta (opcional)';
  }
  $('circular').addEventListener('change', syncOptions);

  /* ---------------- pestañas ---------------- */
  Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tabs [data-tab]'), function (x) {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
      var wear = b.getAttribute('data-tab') === 'wear';
      $('tab-route').hidden = wear;
      $('tab-wear').hidden = !wear;
      if (!wear && map) setTimeout(function () { map.invalidateSize(); }, 30);
    });
  });

  /* ---------------- eje horizontal y coloreado ---------------- */
  Array.prototype.forEach.call($('xaxis').querySelectorAll('[data-x]'), function (b) {
    b.addEventListener('click', function () {
      st.xMode = b.getAttribute('data-x');
      Array.prototype.forEach.call($('xaxis').querySelectorAll('[data-x]'), function (x) {
        x.classList.toggle('on', x === b);
      });
      renderCharts();
      renderReadout();
    });
  });
  $('colorby').addEventListener('change', function () {
    st.colorby = this.value;
    renderMap();
  });

  /* ---------------- resumen ---------------- */
  function card(k, val, sub) {
    return '<div class="card"><span class="k">' + esc(k) + '</span>' +
      '<span class="val">' + val + '</span>' +
      (sub ? '<span class="sub2">' + esc(sub) + '</span>' : '') + '</div>';
  }
  function renderSummary() {
    var s = st.stats, out = [];
    if (st.totalKm != null) {
      out.push(card('Distancia', num(st.totalKm, 1) + ' <small>km</small>',
        'llegada ' + D.hhmm(s.arrivalMin)));
    } else {
      out.push(card('Duración', durShort(s.durationMin),
        'hasta las ' + D.hhmm(s.arrivalMin)));
    }
    if (st.hasEle) {
      out.push(card('Desnivel', '+' + Math.round(st.up) + ' / −' + Math.round(st.down) + ' <small>m</small>'));
    }
    var f = s.feel;
    out.push(card('Sensación en bici',
      num(f.min) + '–' + num(f.max) + ' <small>°C</small>',
      'media ' + num(f.mean) + '° · salida ' + num(f.start) + '°'));
    out.push(card('Temperatura del aire',
      num(s.air.min) + '–' + num(s.air.max) + ' <small>°C</small>'));
    out.push(card('Lluvia', num(s.rain.maxProb) + ' <small>%</small>',
      'máx. ' + num(s.rain.maxPrecip, 1) + ' mm/h'));
    var viento = num(s.gustMax) + ' <small>km/h</small>';
    var sub = s.headwindMean != null
      ? 'de cara ' + num(s.headwindMean) + ' km/h medio'
      : 'rachas máximas';
    out.push(card('Viento', viento, sub));
    $('summary').innerHTML = out.join('');
  }

  /* ---------------- lectura del cursor ---------------- */
  function renderReadout() {
    var s = st.series && st.series[st.cursor];
    if (!s) { $('readout').textContent = ''; return; }
    var parts = [];
    var head = D.hhmm(st.departureMin + s.t);
    if (s.dist != null) head += ' · km ' + num(s.dist, 1);
    parts.push(head);
    parts.push('Aire ' + num(s.temp) + '° · sensación ' + num(s.feel) + '°');
    var v = 'Viento ' + num(s.wind) + ' km/h';
    if (s.headwind != null) {
      v += s.headwind >= 0
        ? ' · de cara ' + num(s.headwind)
        : ' · de cola ' + num(-s.headwind);
    }
    parts.push(v);
    parts.push('Lluvia ' + num(s.precip, 1) + ' mm · ' + num(s.prob) + ' %');
    parts.push('Alt. ' + num(s.ele) + ' m');
    $('readout').textContent = parts.join(' · ');
  }

  /* ---------------- gráficas ---------------- */
  var charts = null;
  function ensureCharts() {
    if (charts) return charts;
    charts = window.Charts.create($('charts'), {
      onCursor: function (i) { setCursor(i); }
    });
    return charts;
  }
  function renderCharts() {
    if (!st.series) return;
    ensureCharts().update({
      series: st.series,
      xMode: st.xMode,
      hasKm: st.totalKm != null,
      hasEle: st.hasEle || st.series.some(function (s) { return s.ele != null; }),
      departureMin: st.departureMin,
      cursor: st.cursor
    });
  }
  function setCursor(i) {
    if (!st.series || !st.series.length) return;
    st.cursor = Math.max(0, Math.min(i, st.series.length - 1));
    if (charts) charts.setCursor(st.cursor);
    renderReadout();
    moveCursorMarker();
  }

  /* ---------------- tarjetas de velocidad ---------------- */
  function renderSpeedopts() {
    var el = $('speedopts');
    if (st.mode !== 'track' || st.arrivalMin != null || !st.profiles) { el.innerHTML = ''; return; }
    var cur = $('speed').value;
    var html = '<h3>Elige tu velocidad media</h3>';
    st.profiles.forEach(function (p) {
      html += '<button type="button" class="speedopt' + (p.key === cur ? ' on' : '') +
        '" data-speed="' + p.key + '">' +
        '<span class="name">' + esc(p.label) + ' · ' + p.vFlat + ' km/h</span>' +
        '<span class="arr">Llegada ' + D.hhmm(p.arrivalMin) + '</span>' +
        '<span class="meta">' + dur(p.durationMin) + ' · media real ' + num(p.avg, 1) + ' km/h</span>' +
        '</button>';
    });
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('[data-speed]'), function (b) {
      b.addEventListener('click', function () {
        $('speed').value = b.getAttribute('data-speed');
        recalcWithSpeed(b.getAttribute('data-speed'));
      });
    });
  }

  /* ---------------- pestaña de ropa ---------------- */
  function renderWear() {
    var rec = st.rec, s = st.stats;
    if (!rec) { $('tab-wear').innerHTML = ''; return; }
    var zones = [['cabeza', 'Cabeza'], ['torso', 'Torso'], ['manos', 'Manos'],
      ['piernas', 'Piernas'], ['pies', 'Pies']];
    var html = '<div class="wear">';
    html += '<div class="wear-head"><div class="band">' + esc(rec.band) + '</div>' +
      '<div class="band-sub">Sensación media de ' + num(s.feel.mean) + '° · de ' +
      num(s.feel.min) + '° a ' + num(s.feel.max) + '° · sensibilidad ' +
      esc($('sens').value) + '</div></div>';

    html += '<section><h3>Qué ponerte</h3><div class="zones">';
    zones.forEach(function (z) {
      var v = rec.garments[z[0]];
      html += '<div class="zone"><span class="k">' + esc(z[1]) + '</span>' +
        '<span class="v' + (v ? '' : ' none') + '">' + esc(v || '—') + '</span></div>';
    });
    html += '</div></section>';

    if (rec.pocket.length) {
      html += '<section class="panel pocket"><h3>Llevar en el bolsillo</h3><ul>' +
        rec.pocket.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></section>';
    }
    if (rec.warnings.length) {
      html += '<section class="panel warn"><h3>Avisos</h3><ul>' +
        rec.warnings.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></section>';
    }
    html += '<section class="panel why"><h3>Por qué</h3><ul>' +
      rec.reasons.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></section>';

    var coldest = bandIndexOf(s.feel.min);
    html += '<section><h3>Franjas</h3><div class="ladder">' +
      R.bands.map(function (b, i) {
        var cls = i === rec.bandIndex ? ' on'
          : (i >= rec.bandIndex && i <= coldest ? ' reached' : '');
        return '<span class="' + cls.trim() + '">' + esc(b.name) + '</span>';
      }).join('') + '</div></section>';
    html += '</div>';
    $('tab-wear').innerHTML = html;
  }
  function bandIndexOf(feel) {
    if (feel == null) return 0;
    return R.bandIndexFor(feel + adjOf($('sens').value));
  }
  function adjOf(sens) { return R.sens[sens] != null ? R.sens[sens] : 0; }

  /* ---------------- pintado general ---------------- */
  function renderAll() {
    $('out').classList.remove('pre');
    $('empty').hidden = true;
    $('demo-note').hidden = !st.demo;
    renderSummary();
    renderMap();
    renderCharts();
    renderReadout();
    renderSpeedopts();
    renderWear();
    setCursor(st.cursor);
  }

  /* ---------------- validación ---------------- */
  function validate() {
    var date = $('date').value, time = $('time').value;
    if (!date || !time) return { err: 'Indica la fecha y la hora de salida.' };
    var diff = D.daysBetween(D.today(), date);
    if (!(diff >= 0 && diff <= 15)) {
      return { err: 'La previsión cubre desde hoy hasta 15 días. Elige una fecha dentro de ese margen.' };
    }
    if (st.mode === 'track' && !st.track) return { err: 'Carga primero un track en formato GPX.' };
    if (st.mode === 'here' && !st.origin) return { err: 'Pulsa «Obtener mi ubicación» o elige un lugar.' };
    if (st.mode === 'place' && !st.origin) return { err: 'Busca un lugar de salida o toca un punto del mapa.' };
    return { date: date, dep: D.toMin(date + 'T' + time) };
  }

  function vFlatOf() { return D.V_FLAT[$('speed').value] || D.V_FLAT.media; }

  function buildSamples(dep, windowMin) {
    var vFlat = vFlatOf();
    st.hasEle = false; st.up = 0; st.down = 0;
    if (st.mode === 'track') {
      var samples = D.sampleTrack(st.track);
      st.totalKm = st.track.totalKm;
      st.hasEle = st.track.hasEle;
      st.up = st.track.up; st.down = st.track.down;
      D.computeTiming(samples, {
        departureMin: dep,
        arrivalMin: st.arrivalGiven ? dep + windowMin : null,
        vFlat: vFlat
      });
      return samples;
    }
    var dest = (!$('circular').checked && st.dest) ? st.dest : null;
    if (dest) {
      var s = D.straightSamples(st.origin, dest, windowMin);
      st.totalKm = s.totalKm;
      D.computeTiming(s, { departureMin: dep, uniform: true, durationMin: windowMin });
      return s;
    }
    var p = D.pointSamples(st.origin, windowMin);
    st.totalKm = null;
    D.computeTiming(p, { departureMin: dep, uniform: true, durationMin: windowMin });
    return p;
  }

  function fetchForecast(samples, durationMin) {
    var start = D.dateOf(st.departureMin);
    var end = D.dateOf(st.departureMin + durationMin + 60);
    return S.forecast({
      lats: samples.map(function (s) { return s.lat; }),
      lons: samples.map(function (s) { return s.lon; }),
      start: start,
      end: end,
      elevations: st.hasEle ? samples.map(function (s) { return Math.round(s.ele); }) : null
    });
  }

  function finishCalculation(samples, hourlies) {
    st.samples = samples;
    st.hourlies = hourlies;
    st.hasBearing = samples.some(function (s) { return s.bearing != null; });
    st.series = D.buildSeries(samples, hourlies, {
      departureMin: st.departureMin, cyclistSpeed: vFlatOf()
    });
    st.stats = D.computeStats(st.series, {
      departureMin: st.departureMin,
      totalKm: st.totalKm, hasEle: st.hasEle, up: st.up, down: st.down
    });
    st.rec = R.recommend(st.stats, st.series, { sens: $('sens').value });
    st.profiles = st.mode === 'track' ? D.speedProfiles(samples, st.departureMin) : null;

    /* eje horizontal */
    var hasKm = st.totalKm != null;
    $('xaxis').querySelector('[data-x="km"]').hidden = !hasKm;
    st.xMode = hasKm ? 'km' : 'time';
    Array.prototype.forEach.call($('xaxis').querySelectorAll('[data-x]'), function (x) {
      x.classList.toggle('on', x.getAttribute('data-x') === st.xMode);
    });
    /* viento de cara solo con rumbo */
    $('colorby').querySelector('option[value="headwind"]').disabled = !st.hasBearing;
    if (st.colorby === 'headwind' && !st.hasBearing) {
      st.colorby = 'feel';
      $('colorby').value = 'feel';
    }
    st.cursor = Math.floor(st.series.length / 2);
    renderAll();
  }

  function recomputeSeries() {
    var samples = st.samples;
    st.series = D.buildSeries(samples, st.hourlies, {
      departureMin: st.departureMin, cyclistSpeed: vFlatOf()
    });
    st.stats = D.computeStats(st.series, {
      departureMin: st.departureMin,
      totalKm: st.totalKm, hasEle: st.hasEle, up: st.up, down: st.down
    });
    st.rec = R.recommend(st.stats, st.series, { sens: $('sens').value });
    st.profiles = st.mode === 'track' ? D.speedProfiles(samples, st.departureMin) : null;
    renderAll();
  }

  function recalcWithSpeed(key) {
    if (!st.samples || !st.hourlies) { calculate(); return; }
    D.computeTiming(st.samples, {
      departureMin: st.departureMin,
      arrivalMin: st.arrivalMin,
      vFlat: D.V_FLAT[key] || vFlatOf()
    });
    recomputeSeries();
  }

  /* ---------------- cálculo principal ---------------- */
  function calculate() {
    if (st.busy) return;
    var v = validate();
    if (v.err) { msg(v.err, 'err'); return; }
    st.busy = true;
    $('go').disabled = true;
    msg('Calculando…', 'ok');

    st.departureMin = v.dep;
    var rawRet = $('ret').value ? D.toMin(v.date + 'T' + $('ret').value) : null;
    st.arrivalGiven = rawRet != null;
    st.windowMin = D.resolveWindow(v.dep, rawRet, parseFloat($('duration').value) || null);
    st.arrivalMin = st.arrivalGiven ? v.dep + st.windowMin : null;

    var samples, duration;
    try {
      samples = buildSamples(v.dep, st.windowMin);
      duration = samples[samples.length - 1].t;
    } catch (e) {
      st.busy = false; $('go').disabled = false;
      msg(e && e.message ? e.message : 'No se ha podido preparar la ruta.', 'err');
      return;
    }

    var prepare;
    if (st.demo) {
      prepare = Promise.resolve(D.simulateHourlies(samples, v.date));
    } else {
      prepare = fetchForecast(samples, duration).then(function (entries) {
        return entries.map(D.prepareHourly);
      });
    }

    prepare.then(function (hourlies) {
      /* Track sin altitud: la aporta la previsión y cambian los tiempos */
      if (st.mode === 'track' && !st.hasEle) {
        samples.forEach(function (s, i) {
          var H = hourlies.length === samples.length ? hourlies[i] : hourlies[0];
          if (s.ele == null && H.elevation != null) s.ele = H.elevation;
        });
        D.assignGrades(samples);
        D.computeTiming(samples, {
          departureMin: v.dep,
          arrivalMin: st.arrivalMin,
          vFlat: vFlatOf()
        });
      }
      finishCalculation(samples, hourlies);
      msg(st.demo ? '' : '', 'ok');
    }).catch(function (e) {
      msg(e && e.message ? e.message : 'Error inesperado al calcular.', 'err');
    }).then(function () {
      st.busy = false;
      $('go').disabled = false;
    });
  }

  /* ---------------- ejemplo con datos simulados ---------------- */
  function runDemo() {
    st.demo = true;
    setMode('track');
    $('circular').checked = false;
    $('ret').value = '';
    $('duration').value = '';
    $('speed').value = 'media';
    $('sens').value = 'normal';
    $('date').value = D.addDays(D.today(), 1);
    $('time').value = '08:30';
    st.dest = null;
    st.origin = null;
    try {
      loadTrackText(D.demoGpxText(), 'Ejemplo');
    } catch (e) {
      st.demo = false;
      msg(e && e.message ? e.message : 'No se ha podido generar el ejemplo.', 'err');
      return;
    }
    syncOptions();
    calculate();
  }

  $('form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    st.demo = false;
    calculate();
  });
  $('demo').addEventListener('click', runDemo);
  $('speed').addEventListener('change', function () { recalcWithSpeed(this.value); });
  $('sens').addEventListener('change', function () {
    if (st.series) {
      st.rec = R.recommend(st.stats, st.series, { sens: this.value });
      renderWear();
    }
  });

  /* ---------------- arranque ---------------- */
  setMode('track');
  $('date').value = D.addDays(D.today(), 1);
  initMap();
})();
