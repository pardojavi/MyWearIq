/* MyWearIQ · tests/domain.test.js — Node + assert, sin dependencias.
   Ejecutar: node tests/domain.test.js */
'use strict';
var assert = require('assert');
var D = require('../src/domain.js');
var R = require('../src/rules.js');

var passed = 0;
function test(n, name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok ' + n + ' · ' + name);
  } catch (e) {
    console.error('FALLO ' + n + ' · ' + name);
    console.error('  ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
}

/* ---------- utilidades de construcción ---------- */
function mk(i, over) {
  var base = {
    t: i * 10, tm: 480 + i * 10, dist: i * 5, lat: 40, lon: -3, ele: 500,
    bearing: 90, grade: 0, speed: 25, cyclistSpeed: 25,
    temp: 12, apparent: 12, wind: 10, gust: 15, dir: 180, headwind: 0,
    precip: 0, prob: 10, code: 1, uv: 2, day: 1, feel: 10
  };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}
function statsOf(series, extra) {
  var opts = Object.assign({ departureMin: 480, totalKm: (series.length - 1) * 5, hasEle: true }, extra || {});
  return D.computeStats(series, opts);
}

/* 1 · Fechas: ida y vuelta de toMin/fromMin, hhmm, dateOf */
test(1, 'Fechas: toMin/fromMin, hhmm, dateOf', function () {
  var m = D.toMin('2026-10-24T08:00');
  assert.strictEqual(m, Date.UTC(2026, 9, 24, 8, 0) / 60000);
  assert.strictEqual(D.fromMin(m), '2026-10-24T08:00');
  assert.strictEqual(D.hhmm(m), '08:00');
  assert.strictEqual(D.dateOf(m), '2026-10-24');
  assert.strictEqual(D.dateOf('2026-10-24T08:00'), '2026-10-24');
  assert.strictEqual(D.fromMin(D.toMin('2027-01-01T23:59')), '2027-01-01T23:59');
  assert.strictEqual(D.addDays('2026-10-24', 2), '2026-10-26');
  assert.strictEqual(D.addDays('2026-10-31', 1), '2026-11-01');
  /* hora local de la ruta tratada como UTC: no se desplaza */
  assert.strictEqual(D.hhmm(D.toMin('2026-06-15T13:45')), '13:45');
});

/* 2 · Haversine y rumbos */
test(2, 'Haversine (1° ≈ 111,195 km) y rumbos N/E/S/O', function () {
  var km = D.haversine(0, 0, 1, 0);
  assert.ok(Math.abs(km - 111.195) < 0.01, '1° de latitud = ' + km);
  assert.ok(Math.abs(D.haversine(40, -3, 41, -3) - 111.195) < 0.3, '1° de meridiano a 40°N');
  var ew = D.haversine(40, -3, 40, -2);
  assert.ok(ew > 84 && ew < 86, '1° de paralelo a 40°N ≈ 85,1 km, es ' + ew);
  assert.ok(Math.abs(D.bearing(0, 0, 1, 0) - 0) < 1e-6, 'norte');
  assert.ok(Math.abs(D.bearing(0, 0, 0, 1) - 90) < 1e-6, 'este');
  assert.ok(Math.abs(D.bearing(1, 0, 0, 0) - 180) < 1e-6, 'sur');
  assert.ok(Math.abs(D.bearing(0, 1, 0, 0) - 270) < 1e-6, 'oeste');
});

/* 3 · GPX: lectura, altitud, desnivel, error con menos de 2 puntos */
test(3, 'GPX: lectura, altitud y desnivel; error con <2 puntos', function () {
  var gpx = '<?xml version="1.0"?><gpx><trk><trkseg>' +
    '<trkpt lat="40.000" lon="-3.000"><ele>100</ele></trkpt>' +
    '<trkpt lat="40.010" lon="-3.000"><ele>200</ele></trkpt>' +
    '<trkpt lat="40.020" lon="-3.000"><ele>150</ele></trkpt>' +
    '</trkseg></trk></gpx>';
  var pts = D.parseGpx(gpx);
  assert.strictEqual(pts.length, 3);
  assert.strictEqual(pts[0].ele, 100);
  var tr = D.buildTrack(pts);
  assert.ok(tr.hasEle, 'con altitud');
  assert.ok(Math.abs(tr.totalKm - 2.224) < 0.02, 'distancia ≈ 2,224 km, es ' + tr.totalKm);
  assert.ok(tr.up > 0 && tr.down > 0, 'desnivel con subidas y bajadas: +' + tr.up + '/−' + tr.down);
  assert.throws(function () { D.parseGpx('<gpx><trkpt lat="40" lon="-3"/></gpx>'); },
    /al menos 2 puntos/);
  assert.throws(function () { D.parseGpx('<gpx></gpx>'); }, /al menos 2 puntos/);
});

/* 4 · GPX: puntos sin altitud y autocerrados */
test(4, 'GPX: puntos sin altitud y puntos autocerrados', function () {
  var gpx = '<gpx><rte>' +
    '<rtept lat="40.0" lon="-3.0"/>' +
    '<rtept lat="40.1" lon="-3.0"/>' +
    '<rtept lat="40.2" lon="-3.0"/>' +
    '</rte></gpx>';
  var pts = D.parseGpx(gpx);
  assert.strictEqual(pts.length, 3, 'lee rtept autocerrados');
  assert.strictEqual(pts[0].ele, null);
  var tr = D.buildTrack(pts);
  assert.strictEqual(tr.hasEle, false, 'sin altitud → hasEle = false');
  assert.strictEqual(tr.up, 0);
  assert.strictEqual(tr.down, 0);
  assert.ok(tr.totalKm > 20 && tr.totalKm < 24, 'distancia de la ruta: ' + tr.totalKm);
  /* mezcla de trkpt con y sin ele → hasEle false */
  var mix = D.parseGpx('<gpx><trkpt lat="40.0" lon="-3.0"><ele>10</ele></trkpt>' +
    '<trkpt lat="40.1" lon="-3.0"/></gpx>');
  assert.strictEqual(D.buildTrack(mix).hasEle, false, 'si falta altitud en alguno, hasEle false');
});

/* 5 · Muestreo */
test(5, 'Muestreo: 8–40 puntos, extremos exactos, rumbo norte', function () {
  var raw = [];
  for (var i = 0; i <= 300; i++) raw.push({ lat: 40 + i * 0.001, lon: -3, ele: 100 + i }); // 33,4 km al norte
  var tr = D.buildTrack(raw);
  var s = D.sampleTrack(tr);
  assert.ok(s.length >= 8 && s.length <= 40, 'n = ' + s.length);
  assert.strictEqual(s.length, D.sampleCount(tr.totalKm));
  assert.strictEqual(s[0].dist, 0);
  assert.ok(Math.abs(s[s.length - 1].dist - tr.totalKm) < 1e-9, 'última muestra en el final');
  s.forEach(function (p) { assert.ok(Math.abs(p.bearing) < 1 || Math.abs(p.bearing - 360) < 1, 'rumbo ' + p.bearing); });
  assert.ok(s[0].ele != null, 'muestra con altitud interpolada');
  /* track muy corto → mínimo 8 */
  var short = D.buildTrack([{ lat: 40, lon: -3, ele: 1 }, { lat: 40.001, lon: -3, ele: 2 }]);
  assert.strictEqual(D.sampleTrack(short).length, 8);
  /* track larguísimo → máximo 40 */
  var raw2 = [];
  for (var j = 0; j <= 600; j++) raw2.push({ lat: 40 + j * 0.01, lon: -3, ele: 100 });
  assert.strictEqual(D.sampleTrack(D.buildTrack(raw2)).length, 40);
});

/* 6 · Tiempos */
test(6, 'Tiempos: duración pedida respetada y perfiles decrecientes', function () {
  var raw = [];
  for (var i = 0; i <= 60; i++) {
    raw.push({ lat: 40 + i * 0.005, lon: -3 + i * 0.005, ele: 100 + 400 * Math.sin(i / 60 * Math.PI) });
  }
  var tr = D.buildTrack(raw);
  var s = D.sampleTrack(tr);
  /* sin hora de llegada, con hora de salida 08:00 */
  var r = D.computeTiming(s, { departureMin: 480, vFlat: 25 });
  assert.ok(r.durationMin > 0);
  /* con hora de llegada: se respeta exactamente */
  var s2 = D.sampleTrack(tr);
  var r2 = D.computeTiming(s2, { departureMin: 480, arrivalMin: 480 + 240, vFlat: 25 });
  assert.ok(Math.abs(r2.durationMin - 240) < 1e-6, 'duración pedida: ' + r2.durationMin);
  assert.ok(Math.abs(s2[s2.length - 1].t - 240) < 1e-6);
  /* los tres perfiles dan duraciones decrecientes */
  var prof = D.speedProfiles(D.sampleTrack(tr), 480);
  assert.strictEqual(prof.length, 3);
  assert.ok(prof[0].durationMin > prof[1].durationMin && prof[1].durationMin > prof[2].durationMin,
    'duraciones ' + prof.map(function (p) { return Math.round(p.durationMin); }).join(' > '));
  assert.ok(prof[0].arrivalMin > prof[1].arrivalMin && prof[1].arrivalMin > prof[2].arrivalMin);
  assert.ok(prof[0].avg < prof[1].avg && prof[1].avg < prof[2].avg, 'velocidad media real creciente');
  /* ruta sin km: reparto uniforme y duración pedida */
  var pts = D.pointSamples({ lat: 40, lon: -3 }, 180);
  var r3 = D.computeTiming(pts, { departureMin: 480, vFlat: 25 });
  assert.strictEqual(r3.durationMin, 180);
  assert.strictEqual(pts[0].speed, null, 'sin km no hay velocidad por tramo');
  assert.strictEqual(D.resolveWindow(480, 420, null), 1380, 'hora de vuelta anterior → +24 h');
  assert.strictEqual(D.resolveWindow(480, null, 3.5), 210);
  assert.strictEqual(D.resolveWindow(480, null, null), 180);
});

/* 7 · Componente de viento */
test(7, 'Componente de viento: de cara, de cola y cruzado', function () {
  assert.ok(Math.abs(D.windComponent(20, 90, 90) - 20) < 1e-9, 'de cara');
  assert.ok(Math.abs(D.windComponent(20, 90, 270) + 20) < 1e-9, 'de cola');
  assert.ok(Math.abs(D.windComponent(20, 90, 0)) < 1e-9, 'cruzado');
  assert.ok(Math.abs(D.windComponent(20, 320, 45) - 20 * Math.cos((320 - 45) * Math.PI / 180)) < 1e-9);
  assert.strictEqual(D.windComponent(20, 90, null), null, 'sin rumbo no hay componente');
});

/* 8 · Sensación por viento */
test(8, 'Sensación por viento: −10 °C a 30 km/h ≈ −19,5 °C', function () {
  var wc = D.windChill(-10, 30);
  assert.ok(Math.abs(wc - (-19.5)) < 0.2, 'windChill(-10,30) = ' + wc);
  assert.strictEqual(D.windChill(15, 30), 15, 'sin efecto con T > 10 °C');
  assert.strictEqual(D.windChill(-10, 4.8), -10, 'sin efecto con v ≤ 4,8 km/h');
  /* sensación en bici */
  assert.ok(D.bikeFeel(5, 4, 20, 10, 25) < 5, 'con viento en contra enfría');
  assert.strictEqual(D.bikeFeel(25, 27, 30, 20, 25), 27, 'con T > 10 usa la aparente');
  assert.strictEqual(D.bikeFeel(5, 4, 2, 0, 2), 5, 'sin velocidad efectiva, sin efecto');
});

/* 9 · Interpolación horaria */
test(9, 'Interpolación: lineal, circular, acumulados y saturación', function () {
  var times = [0, 60, 120];
  var vals = [10, 20, 30];
  assert.strictEqual(D.interpLinear(times, vals, 30), 15, 'lineal');
  assert.strictEqual(D.interpLinear(times, vals, -60), 10, 'saturación al inicio');
  assert.strictEqual(D.interpLinear(times, vals, 999), 30, 'saturación al final');
  /* dirección por el camino corto: 350° → 10° pasa por 0° */
  var dirs = [350, 10];
  var d30 = D.interpDir([0, 60], dirs, 30);
  assert.ok(Math.abs(d30) < 1e-6 || Math.abs(d30 - 360) < 1e-6, '350→10 en 30 min = ' + d30);
  var d15 = D.interpDir([0, 60], dirs, 15);
  assert.ok(d15 > 350 || d15 < 1, 'a los 15 min sigue cerca de 350/0: ' + d15);
  /* acumulados: valor de la hora siguiente */
  assert.strictEqual(D.interpNext(times, [1, 5, 0], 30), 5, 'hora siguiente');
  assert.strictEqual(D.interpNext(times, [1, 5, 0], 90), 0, 'hora siguiente');
  assert.strictEqual(D.interpNext(times, [1, 5, 0], 999), 0, 'saturación');
  /* más cercano: código de tiempo */
  assert.strictEqual(D.interpNearest(times, [1, 61, 2], 20), 1);
  assert.strictEqual(D.interpNearest(times, [1, 61, 2], 45), 61);
  /* null rellenados con el valor anterior */
  assert.deepStrictEqual(D.fillNulls([10, null, null, 40]), [10, 10, 10, 40]);
});

/* 10 · Mañana fría que se calienta → prenda extraíble */
test(10, 'Mañana fría que se calienta → prenda extraíble explicada', function () {
  var feels = [4, 4.5, 5, 5.5, 10, 11, 12, 13, 14, 14];
  var series = feels.map(function (f, i) { return mk(i, { feel: f, temp: f + 1 }); });
  var stats = statsOf(series);
  assert.ok(stats.feel.start <= stats.feel.mean - 4, 'arranque más frío que la media');
  assert.ok(stats.feel.spread >= 8, 'spread ' + stats.feel.spread);
  var rec = R.recommend(stats, series, { sens: 'normal' });
  assert.ok(rec.pocket.length > 0, 'lleva prenda extraíble: ' + JSON.stringify(rec.pocket));
  var why = rec.reasons.join(' | ');
  assert.ok(/extraíble/i.test(why), 'lo explica en «Por qué»');
  assert.ok(/km/.test(why), 'indica hora y km');
});

/* 11 · Lluvia */
test(11, 'Lluvia alta → chubasquero; ≥ 4 mm/h → aviso', function () {
  var series = [0, 1, 2, 3].map(function (i) {
    return mk(i, { prob: 75, precip: 4.2, feel: 9, temp: 10 });
  });
  var stats = statsOf(series);
  var rec = R.recommend(stats, series, { sens: 'normal' });
  assert.ok(/Chubasquero/.test(rec.garments.torso), 'chubasquero: ' + rec.garments.torso);
  assert.ok(rec.warnings.some(function (w) { return /Lluvia intensa prevista/.test(w); }), 'aviso de lluvia intensa');
  assert.ok(rec.pocket.some(function (p) { return /Guardabarros/.test(p); }), 'guardabarros en el bolsillo');
  /* lluvia ligera → solo cortavientos impermeable en el bolsillo */
  var light = [0, 1].map(function (i) { return mk(i, { prob: 45, precip: 0, feel: 12, temp: 14 }); });
  var rec2 = R.recommend(statsOf(light), light, { sens: 'normal' });
  assert.ok(rec2.pocket.some(function (p) { return /impermeable/.test(p); }), 'cortavientos impermeable');
  assert.ok(!rec2.garments.torso || !/Chubasquero/.test(rec2.garments.torso), 'sin chubasquero con lluvia ligera');
  assert.ok(!rec2.warnings.some(function (w) { return /Lluvia intensa/.test(w); }), 'sin aviso de intensa');
});

/* 12 · Sensibilidad al frío */
test(12, 'Friolero elige una franja más abrigada que caluroso', function () {
  var series = [0, 1, 2, 3, 4].map(function (i) { return mk(i, { feel: 10 + i, temp: 11 + i }); });
  var stats = statsOf(series);
  var frio = R.recommend(stats, series, { sens: 'friolero' });
  var calor = R.recommend(stats, series, { sens: 'caluroso' });
  var normal = R.recommend(stats, series, { sens: 'normal' });
  assert.ok(frio.bandIndex > calor.bandIndex, 'friolero=' + frio.band + ' caluroso=' + calor.band);
  assert.ok(frio.bandIndex >= normal.bandIndex && normal.bandIndex >= calor.bandIndex);
});

/* 13 · Avisos de hielo, rachas y falta de luz */
test(13, 'Avisos de hielo, rachas y falta de luz', function () {
  var series = [0, 1, 2, 3].map(function (i) {
    return mk(i, { feel: 6, temp: i === 1 ? 1 : 4, gust: i === 2 ? 46 : 20, day: i === 3 ? 0 : 1 });
  });
  var stats = statsOf(series);
  assert.strictEqual(stats.night, true);
  assert.ok(stats.gustMax >= 40);
  var rec = R.recommend(stats, series, { sens: 'normal' });
  assert.ok(rec.warnings.some(function (w) { return /hielo/i.test(w); }), 'hielo: ' + rec.warnings.join(' / '));
  assert.ok(rec.warnings.some(function (w) { return /Rachas/.test(w); }), 'rachas');
  assert.ok(rec.warnings.some(function (w) { return /sin luz/.test(w); }), 'falta de luz');
  assert.ok(rec.warnings.some(function (w) { return /reflectante/.test(w); }), 'prenda reflectante');
});

/* 14 · Calor */
test(14, 'Calor (28 °C, UV 7) → franja Calor, crema solar, sin extraíble', function () {
  var series = [0, 1, 2, 3, 4].map(function (i) { return mk(i, { feel: 27 + (i % 3), temp: 28, uv: 7 }); });
  var stats = statsOf(series);
  var rec = R.recommend(stats, series, { sens: 'normal' });
  assert.strictEqual(rec.band, 'Calor');
  assert.strictEqual(rec.garments.torso, 'Maillot ligero manga corta');
  assert.strictEqual(rec.garments.piernas, 'Culotte corto');
  assert.ok(rec.warnings.some(function (w) { return /crema solar/.test(w); }), 'crema solar');
  assert.strictEqual(rec.pocket.length, 0, 'sin prenda extraíble: ' + JSON.stringify(rec.pocket));
});

console.log(passed + ' pruebas superadas');
