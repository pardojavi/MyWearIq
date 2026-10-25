/* MyWearIQ · domain.js — lógica pura, sin DOM ni red.
   UMD: window.Domain / module.exports */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Domain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- utilidades ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function round1(v) { return Math.round(v * 10) / 10; }

  /* ---------- fechas (hora local de la ruta, componentes como UTC) ---------- */
  function toMin(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(String(s == null ? '' : s));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) / 60000;
  }
  function fromMin(m) {
    var d = new Date(Math.round(m) * 60000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function hhmm(m) { return fromMin(m).slice(11, 16); }
  function dateOf(x) {
    var s = typeof x === 'number' ? fromMin(x) : String(x == null ? '' : x);
    return s.slice(0, 10);
  }
  function addDays(date, n) { return dateOf(toMin(date + 'T00:00') + n * 1440); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function daysBetween(a, b) {
    return Math.round((toMin(b + 'T00:00') - toMin(a + 'T00:00')) / 1440);
  }
  /* Duración de la ventana: hora de vuelta/llegada, o horas, o 180 min. */
  function resolveWindow(depMin, retMin, hours) {
    if (retMin != null) {
      var d = retMin - depMin;
      if (d <= 0) d += 1440;
      return d;
    }
    if (hours != null && isFinite(hours) && hours > 0) return hours * 60;
    return 180;
  }

  /* ---------- geografía ---------- */
  var R_EARTH = 6371.0088;
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function bearing(lat1, lon1, lat2, lon2) {
    var f1 = toRad(lat1), f2 = toRad(lat2), dl = toRad(lon2 - lon1);
    var y = Math.sin(dl) * Math.cos(f2);
    var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    if (x === 0 && y === 0) return null;
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /* ---------- GPX ---------- */
  var GPX_PT = /<(trkpt|rtept)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/gi;
  var RE_LAT = /\blat="([^"]*)"/i;
  var RE_LON = /\blon="([^"]*)"/i;
  var RE_ELE = /<ele>\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*<\/ele>/i;
  var GPX_LOW_POINTS = 'El GPX no tiene al menos 2 puntos de track o de ruta.';

  function parseGpx(text) {
    var pts = [], m;
    GPX_PT.lastIndex = 0;
    while ((m = GPX_PT.exec(String(text)))) {
      var tag = m[0];
      var la = RE_LAT.exec(tag), lo = RE_LON.exec(tag);
      if (!la || !lo) continue;
      var el = RE_ELE.exec(tag);
      var lat = parseFloat(la[1]), lon = parseFloat(lo[1]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      pts.push({ lat: lat, lon: lon, ele: el ? parseFloat(el[1]) : null });
    }
    if (pts.length < 2) throw new Error(GPX_LOW_POINTS);
    return pts;
  }

  /* Construye la ruta: descarta puntos a <1 m, distancia acumulada,
     altitud suavizada (media móvil centrada, ventana min(5, floor(n/8))) y desnivel. */
  function buildTrack(rawPts) {
    var pts = [], i;
    for (i = 0; i < rawPts.length; i++) {
      var p = rawPts[i];
      if (pts.length) {
        var prev = pts[pts.length - 1];
        if (haversine(prev.lat, prev.lon, p.lat, p.lon) < 0.001) continue;
      }
      pts.push(p);
    }
    if (pts.length < 2) throw new Error(GPX_LOW_POINTS);

    var dist = 0;
    var out = pts.map(function (p, idx) {
      if (idx > 0) dist += haversine(pts[idx - 1].lat, pts[idx - 1].lon, p.lat, p.lon);
      return { lat: p.lat, lon: p.lon, ele: p.ele, dist: dist };
    });
    var totalKm = dist;
    var hasEle = out.every(function (p) { return p.ele != null && isFinite(p.ele); });
    var up = 0, down = 0;
    if (hasEle) {
      var n = out.length;
      var w = Math.min(5, Math.floor(n / 8));
      var sm = out.map(function (_, idx) {
        var s = 0, c = 0;
        for (var j = Math.max(0, idx - w); j <= Math.min(n - 1, idx + w); j++) { s += out[j].ele; c++; }
        return s / c;
      });
      for (i = 1; i < n; i++) {
        var d = sm[i] - sm[i - 1];
        if (d > 0) up += d; else down -= d;
      }
      out.forEach(function (p, idx) { p.sele = sm[idx]; });
    }
    return { pts: out, totalKm: totalKm, hasEle: hasEle, up: up, down: down };
  }

  /* ---------- muestreo ---------- */
  function sampleCount(totalKm) { return clamp(Math.round(totalKm / 3) + 1, 8, 40); }

  function sampleTrack(track) {
    var pts = track.pts;
    var n = sampleCount(track.totalKm);
    var samples = [], seg = 0, j;
    for (j = 0; j < n; j++) {
      var d = track.totalKm * j / (n - 1);
      while (seg < pts.length - 2 && pts[seg + 1].dist < d) seg++;
      var a = pts[seg], b = pts[seg + 1] || pts[seg];
      var span = b.dist - a.dist;
      var f = span > 0 ? (d - a.dist) / span : 0;
      var ea = a.sele != null ? a.sele : a.ele;
      var eb = b.sele != null ? b.sele : b.ele;
      var ele = (track.hasEle && ea != null && eb != null) ? ea + (eb - ea) * f : null;
      samples.push({
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        dist: d,
        ele: ele
      });
    }
    for (j = 0; j < n; j++) {
      var p = samples[Math.max(0, j - 1)];
      var q = samples[Math.min(n - 1, j + 1)];
      samples[j].bearing = (p === q) ? null : bearing(p.lat, p.lon, q.lat, q.lon);
      samples[j].grade = null;
    }
    assignGrades(samples);
    return samples;
  }

  /* grade = pendiente (%) del tramo que empieza en la muestra (última = anterior). */
  function assignGrades(samples) {
    var n = samples.length;
    for (var i = 0; i < n - 1; i++) {
      var a = samples[i], b = samples[i + 1];
      var dKm = b.dist - a.dist;
      if (a.ele == null || b.ele == null || !(dKm > 0)) { a.grade = null; continue; }
      a.grade = (b.ele - a.ele) / (dKm * 10); /* m / (km*10) = % */
    }
    if (n > 1) samples[n - 1].grade = samples[n - 2].grade;
    else if (n === 1) samples[0].grade = null;
  }

  /* ---------- rutas sin track ---------- */
  function straightSamples(origin, dest, durationMin) {
    var n = 6;
    var total = haversine(origin.lat, origin.lon, dest.lat, dest.lon);
    var brg = bearing(origin.lat, origin.lon, dest.lat, dest.lon);
    var out = [];
    for (var i = 0; i < n; i++) {
      var f = i / (n - 1);
      out.push({
        lat: origin.lat + (dest.lat - origin.lat) * f,
        lon: origin.lon + (dest.lon - origin.lon) * f,
        dist: total * f,
        ele: null,
        bearing: brg,
        grade: null
      });
    }
    out.totalKm = total;
    out.uniform = true;
    out.durationMin = durationMin;
    return out;
  }

  function pointSamples(origin, durationMin) {
    var n = Math.max(3, Math.round(durationMin / 30) + 1);
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({ lat: origin.lat, lon: origin.lon, dist: null, ele: null, bearing: null, grade: null });
    }
    out.totalKm = null;
    out.uniform = true;
    out.durationMin = durationMin;
    return out;
  }

  /* ---------- tiempos de paso ---------- */
  var V_FLAT = { relajada: 20, media: 25, rapida: 30 };
  var V_DESC = 38, CLIMB_RATE = 700;

  function segmentMinutes(a, b, vFlat, vDesc, climbRate) {
    var dKm = b.dist - a.dist;
    var hasEle = a.ele != null && b.ele != null;
    var dEle = hasEle ? b.ele - a.ele : 0;
    var grade = (hasEle && dKm > 0) ? dEle / (dKm * 10) : null;
    var v = (grade != null && grade < -3) ? Math.max(vFlat, vDesc) : vFlat;
    return dKm / v * 60 + (dEle > 0 ? dEle / climbRate * 60 : 0);
  }

  /* opts: {departureMin, arrivalMin|null, vFlat, uniform, durationMin} */
  function computeTiming(samples, opts) {
    var n = samples.length;
    if (n < 2) return { durationMin: 0 };
    var vFlat = opts.vFlat || V_FLAT.media;
    var uniform = !!opts.uniform || samples[0].dist == null;
    var segs = [], i;
    var totalKm = samples[n - 1].dist;

    if (uniform) {
      var dur = opts.durationMin || 180;
      for (i = 0; i < n - 1; i++) segs.push(dur / (n - 1));
    } else {
      for (i = 0; i < n - 1; i++) segs.push(segmentMinutes(samples[i], samples[i + 1], vFlat, V_DESC, CLIMB_RATE));
    }

    var t = [0];
    for (i = 0; i < n - 1; i++) t.push(t[i] + segs[i]);
    var total = t[n - 1];

    if (opts.arrivalMin != null && total > 0) {
      var want = opts.arrivalMin - opts.departureMin;
      var f = want / total;
      for (i = 1; i < n; i++) t[i] *= f;
      for (i = 0; i < n - 1; i++) segs[i] *= f;
      total = want;
    }

    var flatSpeed = null;
    if (uniform && totalKm != null && total > 0) flatSpeed = Math.max(8, totalKm / (total / 60));

    for (i = 0; i < n - 1; i++) {
      samples[i].t = t[i];
      samples[i].segMin = segs[i];
      samples[i].speed = uniform
        ? (samples[0].dist == null ? null : flatSpeed)
        : (segs[i] > 0 ? (samples[i + 1].dist - samples[i].dist) / (segs[i] / 60) : 0);
    }
    samples[n - 1].t = t[n - 1];
    samples[n - 1].segMin = 0;
    samples[n - 1].speed = samples[n - 2].speed;
    return { durationMin: total };
  }

  /* Perfiles 20/25/30 km/h: duración, llegada y velocidad media real (sin hora de llegada). */
  function speedProfiles(samples, departureMin) {
    var keys = ['relajada', 'media', 'rapida'];
    var n = samples.length;
    if (n < 2) return [];
    return keys.map(function (k) {
      var vFlat = V_FLAT[k];
      var total = 0;
      for (var i = 0; i < n - 1; i++) total += segmentMinutes(samples[i], samples[i + 1], vFlat, V_DESC, CLIMB_RATE);
      var km = samples[n - 1].dist;
      return {
        key: k,
        label: k === 'relajada' ? 'Relajada' : k === 'media' ? 'Media' : 'Rápida',
        vFlat: vFlat,
        durationMin: total,
        arrivalMin: departureMin + total,
        avg: km != null && total > 0 ? km / (total / 60) : null
      };
    });
  }

  /* ---------- viento y sensación ---------- */
  /* dir = dirección desde la que sopla (°); bearing = rumbo del ciclista (°).
     Componente en contra positiva = de cara. */
  function windComponent(windSpeed, dirFrom, trackBearing) {
    if (windSpeed == null || dirFrom == null || trackBearing == null) return null;
    return windSpeed * Math.cos(toRad(dirFrom - trackBearing));
  }

  /* Environment Canada / NWS, válida con T <= 10 °C y v > 4,8 km/h. */
  function windChill(T, v) {
    if (!(T <= 10 && v > 4.8)) return T;
    var p = Math.pow(v, 0.16);
    return 13.12 + 0.6215 * T - 11.37 * p + 0.3965 * T * p;
  }

  /* Sensación en bici: v = max(0, velocidadCiclista + vientoEnContra). */
  function bikeFeel(temp, apparent, wind, headwind, cyclistSpeed) {
    if (temp == null) return null;
    var v = Math.max(0, (cyclistSpeed || 0) + (headwind || 0));
    if (temp > 10) return apparent != null ? apparent : temp;
    return windChill(temp, v);
  }

  /* ---------- interpolación de la previsión ---------- */
  function fillNulls(arr) {
    var out = arr.slice(), last = null, i;
    for (i = 0; i < out.length; i++) {
      if (out[i] == null || !isFinite(out[i])) out[i] = last != null ? last : 0;
      else last = out[i];
    }
    if (out.length && (arr[0] == null || !isFinite(arr[0]))) {
      var first = null;
      for (i = 0; i < arr.length; i++) if (arr[i] != null && isFinite(arr[i])) { first = arr[i]; break; }
      if (first != null) for (i = 0; i < out.length; i++) if (arr[i] == null) out[i] = first;
    }
    return out;
  }

  /* Índice y fracción para el instante tm (saturando en los extremos). */
  function slot(times, tm) {
    var n = times.length;
    if (n === 0) return null;
    if (tm <= times[0]) return { i: 0, f: 0 };
    if (tm >= times[n - 1]) return { i: n - 1, f: 0 };
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (times[mid] <= tm) lo = mid; else hi = mid;
    }
    var span = times[hi] - times[lo];
    return { i: lo, f: span > 0 ? (tm - times[lo]) / span : 0 };
  }
  function interpLinear(times, vals, tm) {
    if (!vals.length) return null;
    var s = slot(times, tm); if (!s) return null;
    if (s.i >= vals.length - 1 || s.f === 0) return vals[s.i];
    return vals[s.i] + (vals[s.i + 1] - vals[s.i]) * s.f;
  }
  /* Acumulados (precipitación, probabilidad): valor de la hora siguiente. */
  function interpNext(times, vals, tm) {
    var n = vals.length;
    if (!n) return null;
    if (tm < times[0]) return vals[0];
    if (tm >= times[n - 1]) return vals[n - 1];
    for (var i = 0; i < n - 1; i++) if (tm < times[i + 1]) return vals[i + 1];
    return vals[n - 1];
  }
  function interpNearest(times, vals, tm) {
    if (!vals.length) return null;
    var s = slot(times, tm); if (!s) return null;
    if (s.i >= vals.length - 1) return vals[s.i];
    return s.f < 0.5 ? vals[s.i] : vals[s.i + 1];
  }
  /* Dirección: por el camino corto del círculo. */
  function interpDir(times, vals, tm) {
    if (!vals.length) return null;
    var s = slot(times, tm); if (!s) return null;
    if (s.i >= vals.length - 1 || s.f === 0) return vals[s.i];
    var a = vals[s.i], b = vals[s.i + 1];
    var d = ((b - a + 540) % 360) - 180;
    return ((a + d * s.f) % 360 + 360) % 360;
  }

  var HOURLY_KEYS = ['temperature_2m', 'apparent_temperature', 'precipitation',
    'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m',
    'wind_gusts_10m', 'weather_code', 'uv_index', 'is_day'];

  /* Prepara la respuesta de un punto: minutos + arrays sin null. */
  function prepareHourly(entry) {
    var h = { times: (entry.time || []).map(toMin).filter(function (m) { return m != null; }) };
    HOURLY_KEYS.forEach(function (k) {
      var a = entry[k];
      h[k] = Array.isArray(a) ? fillNulls(a) : [];
    });
    h.elevation = entry.elevation != null ? entry.elevation : null;
    return h;
  }

  /* Serie por muestra: interpolación temporal de todos los campos. */
  function buildSeries(samples, hourlies, ctx) {
    var dep = ctx.departureMin;
    var n = samples.length;
    var out = [];
    for (var i = 0; i < n; i++) {
      var s = samples[i];
      var H = hourlies.length === n ? hourlies[i] : hourlies[0];
      var tm = dep + (s.t || 0);
      var temp = interpLinear(H.times, H.temperature_2m, tm);
      var apparent = interpLinear(H.times, H.apparent_temperature, tm);
      if (apparent == null) apparent = temp;
      var wind = interpLinear(H.times, H.wind_speed_10m, tm);
      var gust = interpLinear(H.times, H.wind_gusts_10m, tm);
      var dir = interpDir(H.times, H.wind_direction_10m, tm);
      var precip = interpNext(H.times, H.precipitation, tm);
      var prob = interpNext(H.times, H.precipitation_probability, tm);
      var code = interpNearest(H.times, H.weather_code, tm);
      var uv = interpLinear(H.times, H.uv_index, tm);
      var day = interpNearest(H.times, H.is_day, tm);
      if (s.ele == null && H.elevation != null) s.ele = H.elevation;
      var cyclistSpeed = s.speed != null ? s.speed : (ctx.cyclistSpeed || V_FLAT.media);
      var headwind = windComponent(wind, dir, s.bearing);
      var feel = bikeFeel(temp, apparent, wind, headwind, cyclistSpeed);
      out.push({
        t: s.t || 0, tm: tm, dist: s.dist, lat: s.lat, lon: s.lon, ele: s.ele,
        bearing: s.bearing, grade: s.grade, speed: s.speed, cyclistSpeed: cyclistSpeed,
        temp: temp, apparent: apparent, wind: wind, gust: gust, dir: dir,
        headwind: headwind, precip: precip, prob: prob, code: code, uv: uv, day: day,
        feel: feel
      });
    }
    return out;
  }

  /* ---------- estadísticas de la ruta ---------- */
  function computeStats(series, opts) {
    opts = opts || {};
    var n = series.length;
    var st = {
      durationMin: n ? series[n - 1].t : 0,
      arrivalMin: opts.departureMin != null ? opts.departureMin + (n ? series[n - 1].t : 0) : null,
      departureMin: opts.departureMin != null ? opts.departureMin : null,
      totalKm: opts.totalKm != null ? opts.totalKm : null,
      hasEle: !!opts.hasEle,
      up: opts.up || 0, down: opts.down || 0,
      night: false, descents: []
    };
    if (!n) return st;

    var fMin = Infinity, fMax = -Infinity, fSum = 0, iMin = 0, iMax = 0;
    var aMin = Infinity, aMax = -Infinity;
    var maxProb = null, maxPrecip = null, gustMax = null, uvMax = null;
    var hwSum = 0, hwCount = 0, startSum = 0, startCount = 0;

    for (var i = 0; i < n; i++) {
      var s = series[i];
      if (s.feel != null) {
        fSum += s.feel;
        if (s.feel < fMin) { fMin = s.feel; iMin = i; }
        if (s.feel > fMax) { fMax = s.feel; iMax = i; }
      }
      if (s.temp != null) { if (s.temp < aMin) aMin = s.temp; if (s.temp > aMax) aMax = s.temp; }
      if (s.prob != null) maxProb = maxProb == null ? s.prob : Math.max(maxProb, s.prob);
      if (s.precip != null) maxPrecip = maxPrecip == null ? s.precip : Math.max(maxPrecip, s.precip);
      if (s.gust != null) gustMax = gustMax == null ? s.gust : Math.max(gustMax, s.gust);
      if (s.uv != null) uvMax = uvMax == null ? s.uv : Math.max(uvMax, s.uv);
      if (s.day === 0) st.night = true;
      if (s.headwind != null) { hwSum += s.headwind; hwCount++; }
      if (s.t <= 30 && s.feel != null) { startSum += s.feel; startCount++; }
    }

    st.feel = {
      min: isFinite(fMin) ? fMin : null,
      max: isFinite(fMax) ? fMax : null,
      mean: n ? fSum / n : null,
      minIdx: iMin, maxIdx: iMax,
      start: startCount ? startSum / startCount : null,
      spread: isFinite(fMin) && isFinite(fMax) ? fMax - fMin : 0
    };
    st.air = { min: isFinite(aMin) ? aMin : null, max: isFinite(aMax) ? aMax : null };
    st.rain = { maxProb: maxProb, maxPrecip: maxPrecip };
    st.gustMax = gustMax;
    st.uvMax = uvMax;
    st.headwindMean = hwCount ? hwSum / hwCount : null;

    /* Descensos largos: tramos consecutivos con pendiente < −3 % y longitud ≥ 2 km. */
    var cur = null;
    function closeCur() {
      if (cur && cur.len >= 2) {
        var mFeel = Infinity, mIdx = cur.start;
        for (var j = cur.start; j <= cur.end; j++) {
          var fj = series[j] && series[j].feel;
          if (fj != null && fj < mFeel) { mFeel = fj; mIdx = j; }
        }
        st.descents.push({
          startIdx: cur.start, endIdx: cur.end, km: cur.len,
          at: mIdx, minFeel: isFinite(mFeel) ? mFeel : null
        });
      }
      cur = null;
    }
    if (st.totalKm != null) {
      for (i = 0; i < n - 1; i++) {
        var g = series[i].grade;
        var segLen = (series[i].dist != null && series[i + 1].dist != null)
          ? series[i + 1].dist - series[i].dist : 0;
        if (g != null && g < -3) {
          if (!cur) cur = { start: i, end: i, len: 0 };
          cur.end = i + 1;
          cur.len += segLen;
        } else closeCur();
      }
      closeCur();
    }
    return st;
  }

  /* ---------- ejemplo con datos simulados (§17) ---------- */
  function demoGpxText() {
    var n = 160, lines = [];
    for (var i = 0; i <= n; i++) {
      var a = i / n * Math.PI * 2;
      var lat = 39.55 + 0.12 * Math.sin(a) * (1 + 0.15 * Math.sin(3 * a));
      var lon = -0.60 + 0.17 * (1 - Math.cos(a)) - 0.17;
      var ele = 60 + 560 * Math.pow(Math.sin(a / 2), 2) + 30 * Math.sin(5 * a);
      lines.push('      <trkpt lat="' + lat.toFixed(6) + '" lon="' + lon.toFixed(6) +
        '"><ele>' + ele.toFixed(1) + '</ele></trkpt>');
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MyWearIQ">\n' +
      '  <trk>\n    <name>Ejemplo</name>\n    <trkseg>\n' + lines.join('\n') +
      '\n    </trkseg>\n  </trk>\n</gpx>\n';
  }

  /* 48 h desde las 00:00 de la fecha de salida, por punto (hr = k mod 24). */
  function simulateHourlies(samples, dateStr) {
    var base = toMin(dateStr + 'T00:00');
    return samples.map(function (s) {
      var ele = s.ele != null ? s.ele : 80;
      var H = { times: [], temperature_2m: [], apparent_temperature: [], precipitation: [],
        precipitation_probability: [], wind_speed_10m: [], wind_direction_10m: [],
        wind_gusts_10m: [], weather_code: [], uv_index: [], is_day: [], elevation: ele };
      for (var k = 0; k < 48; k++) {
        var hr = k % 24;
        var warm = clamp((hr - 6) / 7, 0, 1) * (hr > 16 ? Math.max(0, 1 - (hr - 16) / 6) : 1);
        var T = 5 + 11 * warm - 6.5 * (ele / 1000);
        var app = T - 1.5 + (warm > 0.5 ? 2 : 0);
        var lluvia = (hr >= 11 && hr <= 13) && ele > 250;
        H.times.push(base + k * 60);
        H.temperature_2m.push(round1(T));
        H.apparent_temperature.push(round1(app));
        H.precipitation.push(lluvia ? 1.2 : 0);
        H.precipitation_probability.push(lluvia ? 75 : 10);
        H.wind_speed_10m.push(12 + 8 * warm);
        H.wind_direction_10m.push(320);
        H.wind_gusts_10m.push(24 + 14 * warm);
        H.weather_code.push(lluvia ? 61 : (warm > 0.4 ? 2 : 1));
        H.uv_index.push(Math.round(4 * warm * 10) / 10);
        H.is_day.push(hr >= 7 && hr <= 19 ? 1 : 0);
      }
      return H;
    });
  }

  return {
    /* fechas */
    toMin: toMin, fromMin: fromMin, hhmm: hhmm, dateOf: dateOf, addDays: addDays,
    today: today, daysBetween: daysBetween, resolveWindow: resolveWindow,
    clamp: clamp, pad2: pad2, round1: round1,
    /* geografía */
    haversine: haversine, bearing: bearing,
    /* GPX y rutas */
    parseGpx: parseGpx, buildTrack: buildTrack,
    sampleCount: sampleCount, sampleTrack: sampleTrack, assignGrades: assignGrades,
    straightSamples: straightSamples, pointSamples: pointSamples,
    /* tiempos */
    V_FLAT: V_FLAT, V_DESC: V_DESC, CLIMB_RATE: CLIMB_RATE,
    computeTiming: computeTiming, speedProfiles: speedProfiles,
    /* viento y sensación */
    windComponent: windComponent, windChill: windChill, bikeFeel: bikeFeel,
    /* previsión */
    fillNulls: fillNulls, slot: slot, interpLinear: interpLinear, interpNext: interpNext,
    interpNearest: interpNearest, interpDir: interpDir,
    prepareHourly: prepareHourly, buildSeries: buildSeries,
    /* estadísticas */
    computeStats: computeStats,
    /* ejemplo */
    demoGpxText: demoGpxText, simulateHourlies: simulateHourlies
  };
});
