/* MyWearIQ · rules.js — reglas de ropa como datos.
   UMD: window.ClothingRules / module.exports */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClothingRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Franjas de más calor a más frío. `from` = sensación desde la que se entra. */
  var BANDS = [
    { name: 'Calor', from: 25,
      cabeza: 'Casco ventilado, gafas', torso: 'Maillot ligero manga corta',
      manos: null, piernas: 'Culotte corto', pies: 'Calcetín fino', extra: null },
    { name: 'Templado', from: 18,
      cabeza: 'Gafas', torso: 'Maillot manga corta',
      manos: 'Guantes cortos', piernas: 'Culotte corto', pies: 'Calcetín fino',
      extra: 'Manguitos finos' },
    { name: 'Fresco', from: 12,
      cabeza: 'Gafas', torso: 'Maillot manga corta, manguitos',
      manos: 'Guantes finos', piernas: 'Culotte corto o con perneras',
      pies: 'Calcetín medio', extra: 'Chaleco cortavientos' },
    { name: 'Frío', from: 7,
      cabeza: 'Braga de cuello', torso: 'Maillot térmico manga larga, chaleco cortavientos',
      manos: 'Guantes largos', piernas: 'Culotte largo o perneras',
      pies: 'Cubrezapatillas finos', extra: 'Cortavientos ligero' },
    { name: 'Muy frío', from: 2,
      cabeza: 'Gorro bajo el casco, braga', torso: 'Capa base, maillot térmico, chaqueta cortavientos o softshell',
      manos: 'Guantes de invierno', piernas: 'Culotte largo térmico',
      pies: 'Cubrebotas', extra: 'Chaqueta cortavientos o softshell' },
    { name: 'Helada', from: -Infinity,
      cabeza: 'Gorro, braga', torso: 'Capa base gruesa, maillot térmico, chaqueta',
      manos: 'Guantes de invierno', piernas: 'Culotte largo térmico',
      pies: 'Cubrebotas', extra: 'Chaleco térmico de repuesto' }
  ];

  /* Propuesta inicial, calibrable por el usuario. */
  var THRESHOLDS = {
    layerSpread: 8,          /* °C de diferencia máx−mín que pide prenda extraíble */
    coldStartDiff: 4,        /* °C: arranque más frío que la media */
    rainLightPop: 40,        /* % */
    rainStrongPop: 70,       /* % */
    rainStrongMm: 1,         /* mm/h */
    rainAbortMm: 4,          /* mm/h */
    gustWarn: 40,            /* km/h */
    headwindSustained: 15,   /* km/h */
    uvHigh: 6,
    iceTemp: 3               /* °C de temperatura mínima del aire */
  };

  var SENS = { friolero: -3, normal: 0, caluroso: 3 };
  var ZONES = ['cabeza', 'torso', 'manos', 'piernas', 'pies'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function bandIndexFor(value) {
    for (var i = 0; i < BANDS.length; i++) if (value >= BANDS[i].from) return i;
    return BANDS.length - 1;
  }

  /* Referencia «HH:MM, km K.K» (solo hora si no hay km). */
  var _dep = null;
  function depDomain() {
    if (typeof module === 'object' && module.exports) return require('./domain.js');
    return (typeof window !== 'undefined' && window.Domain) || null;
  }
  function at(series, stats, idx) {
    var s = series && series[idx];
    if (!s) return '';
    var D = depDomain();
    var when = D ? D.hhmm((_dep != null ? _dep : 0) + (s.t || 0)) : '';
    var km = (s.dist != null) ? 'km ' + (Math.round(s.dist * 10) / 10).toFixed(1) : null;
    return km ? (when + ', ' + km) : when;
  }

  function splitItems(str) {
    return String(str || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function addUnique(list, item) {
    if (!item) return;
    if (list.indexOf(item) === -1) list.push(item);
  }
  function hasZone(garments, item) {
    var needle = item.toLowerCase();
    return ZONES.some(function (z) {
      return splitItems(garments[z]).some(function (g) { return g.toLowerCase() === needle; });
    });
  }
  function addGarment(garments, zone, item) {
    if (!item) return;
    var parts = splitItems(garments[zone]);
    var low = item.toLowerCase();
    if (parts.some(function (p) { return p.toLowerCase() === low; })) return;
    /* misma prenda de la zona (p. ej. cubrezapatillas finos → impermeables): se sustituye */
    var first = low.split(' ')[0];
    var idx = -1;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].toLowerCase().split(' ')[0] === first) { idx = i; break; }
    }
    if (idx >= 0) parts[idx] = item; else parts.push(item);
    garments[zone] = parts.join(', ');
  }
  function addReason(reasons, text) { addUnique(reasons, text); }
  function addWarning(warnings, text) { addUnique(warnings, text); }

  /* recommend(stats, series, prefs, rules) */
  function recommend(stats, series, prefs, rules) {
    prefs = prefs || {};
    rules = rules || { bands: BANDS, thresholds: THRESHOLDS, sens: SENS };
    var bands = rules.bands || BANDS;
    var th = rules.thresholds || THRESHOLDS;
    var sensAdj = rules.sens || SENS;

    series = series || [];
    _dep = (stats && stats.departureMin != null) ? stats.departureMin : (series[0] ? series[0].tm - (series[0].t || 0) : null);

    var feel = (stats && stats.feel) || {};
    var rain = (stats && stats.rain) || {};
    var adj = sensAdj[prefs.sens] != null ? sensAdj[prefs.sens] : 0;
    var value = (feel.mean != null ? feel.mean : 0) + adj;
    var bandIndex = bandIndexFor(value);
    var band = bands[bandIndex];

    var garments = {};
    ZONES.forEach(function (z) { garments[z] = band[z] || null; });
    var pocket = [], warnings = [], reasons = [];

    /* 1 · franja por sensación media + sensibilidad */
    addReason(reasons, 'Sensación media de ' + fmt(value - adj) + '° (ajuste ' +
      (adj > 0 ? '+' : '') + adj + '°) → franja «' + band.name + '».');

    /* 2 · prenda extraíble */
    var spread = feel.spread || 0;
    var startDiff = (feel.start != null && feel.mean != null) ? (feel.mean - feel.start) : 0;
    if (spread >= th.layerSpread || startDiff >= th.coldStartDiff) {
      var coldest = feel.minIdx != null ? bandIndexFor(feel.min + adj) : bandIndex;
      if (coldest === bandIndex) coldest = Math.min(bandIndex + 1, bands.length - 1);
      var extra = bands[coldest].extra;
      if (extra && !hasZone(garments, extra)) addUnique(pocket, extra);
      var coldAt = at(series, stats, feel.minIdx);
      var partes = [];
      if (spread >= th.layerSpread) partes.push('la sensación varía ' + fmt(spread) + '° en ruta');
      if (startDiff >= th.coldStartDiff) partes.push('los primeros 30 min hacen ' + fmt(startDiff) + '° menos que la media');
      addReason(reasons, 'Prenda extraíble en el bolsillo porque ' + partes.join(' y ') +
        (coldAt ? '. Punto más frío: ' + coldAt + ' (' + fmt(feel.min) + '°)' : '.'));
    }

    /* 3 · lluvia */
    var strongRain = (rain.maxProb != null && rain.maxProb >= th.rainStrongPop) ||
      (rain.maxPrecip != null && rain.maxPrecip >= th.rainStrongMm);
    var lightRain = !strongRain && rain.maxProb != null && rain.maxProb >= th.rainLightPop;
    if (strongRain) {
      addGarment(garments, 'torso', 'Chubasquero');
      addGarment(garments, 'pies', 'Cubrezapatillas impermeables');
      addGarment(garments, 'cabeza', 'Gafas de lente clara');
      addGarment(garments, 'cabeza', 'Gorra bajo el casco');
      addUnique(pocket, 'Guardabarros');
      addUnique(pocket, 'Guantes de repuesto');
      var rIdx = indexOfMax(series, 'precip');
      addReason(reasons, 'Lluvia (hasta ' + fmt(rain.maxProb) + ' % y ' + fmt(rain.maxPrecip) +
        ' mm/h' + (rIdx >= 0 ? ', ' + at(series, stats, rIdx) : '') + '): chubasquero y calzado impermeable.');
    } else if (lightRain) {
      addUnique(pocket, 'Cortavientos ligero impermeable');
      var pIdx = indexOfMax(series, 'prob');
      addReason(reasons, 'Probabilidad de lluvia del ' + fmt(rain.maxProb) + ' %' +
        (pIdx >= 0 ? ' (' + at(series, stats, pIdx) + ')' : '') +
        ': llévate un cortavientos impermeable en el bolsillo.');
    }
    if (rain.maxPrecip != null && rain.maxPrecip >= th.rainAbortMm) {
      addWarning(warnings, 'Lluvia intensa prevista. Valora cambiar la salida.');
    }

    /* rachas */
    if (stats.gustMax != null && stats.gustMax >= th.gustWarn) {
      var gIdx = indexOfMax(series, 'gust');
      addWarning(warnings, 'Rachas de ' + fmt(stats.gustMax) + ' km/h' +
        (gIdx >= 0 ? ' hacia las ' + at(series, stats, gIdx) : '') + ': cuidado en descampados y descensos.');
      addReason(reasons, 'Rachas de ' + fmt(stats.gustMax) + ' km/h superan el umbral de ' +
        th.gustWarn + ' km/h' + (gIdx >= 0 ? ' (' + at(series, stats, gIdx) + ')' : '') + '.');
    }

    /* viento de cara sostenido */
    if (stats.headwindMean != null && stats.headwindMean >= th.headwindSustained) {
      var torsoHas = splitItems(garments.torso).some(function (g) { return /cortavientos|softshell|chubasquero/i.test(g); });
      if (!torsoHas) addGarment(garments, 'torso', 'Cortavientos ligero');
      addReason(reasons, 'Viento de cara medio de ' + fmt(stats.headwindMean) +
        ' km/h: cortavientos en el torso' + (torsoHas ? ' (ya lo llevas)' : '') + '.');
    }

    /* descensos largos */
    (stats.descents || []).forEach(function (d) {
      addWarning(warnings, 'Descenso largo de ' + fmt(d.km) + ' km' +
        (d.at != null && series[d.at] ? ' a las ' + at(series, stats, d.at) : '') +
        (d.minFeel != null ? ': sensación de ' + fmt(d.minFeel) + '°.' : '.'));
      addReason(reasons, 'Descenso de ' + fmt(d.km) + ' km con sensación baja de ' +
        fmt(d.minFeel) + '°' + (d.at != null && series[d.at] ? ' (' + at(series, stats, d.at) + ')' : '') + '.');
    });

    /* UV */
    if (stats.uvMax != null && stats.uvMax >= th.uvHigh) {
      var uIdx = indexOfMax(series, 'uv');
      addWarning(warnings, 'Índice UV de ' + fmt(stats.uvMax) + ': gafas de sol y crema solar.');
      addReason(reasons, 'UV de ' + fmt(stats.uvMax) + ' ≥ ' + th.uvHigh +
        (uIdx >= 0 ? ' (' + at(series, stats, uIdx) + ')' : '') + ': gafas de sol y crema solar.');
    }

    /* falta de luz */
    if (stats.night) {
      var nIdx = indexOfNight(series);
      addWarning(warnings, 'Hay tramos sin luz: luces delante y detrás y prenda reflectante.');
      addReason(reasons, 'Tramos sin luz' + (nIdx >= 0 ? ' (' + at(series, stats, nIdx) + ')' : '') +
        ': luces y prenda reflectante.');
    }

    /* hielo */
    if (stats.air && stats.air.min != null && stats.air.min < th.iceTemp) {
      var iIdx = indexOfMin(series, 'temp');
      addWarning(warnings, 'Temperatura mínima de ' + fmt(stats.air.min) +
        '°: posible hielo en el firme, sobre todo en sombras y puentes.');
      addReason(reasons, 'Aire mínimo de ' + fmt(stats.air.min) + '° < ' + th.iceTemp + '°' +
        (iIdx >= 0 ? ' (' + at(series, stats, iIdx) + ')' : '') + ': riesgo de hielo.');
    }

    return {
      band: band.name, bandIndex: bandIndex, garments: garments,
      pocket: pocket, warnings: warnings, reasons: reasons
    };
  }

  function fmt(v) {
    if (v == null || !isFinite(v)) return '—';
    var r = Math.round(v * 10) / 10;
    return (Math.abs(r - Math.round(r)) < 0.05) ? String(Math.round(r)) : String(r);
  }

  function indexOfMax(series, key) {
    var best = -1, bv = -Infinity;
    for (var i = 0; i < (series || []).length; i++) {
      var v = series[i][key];
      if (v != null && isFinite(v) && v > bv) { bv = v; best = i; }
    }
    return best;
  }
  function indexOfMin(series, key) {
    var best = -1, bv = Infinity;
    for (var i = 0; i < (series || []).length; i++) {
      var v = series[i][key];
      if (v != null && isFinite(v) && v < bv) { bv = v; best = i; }
    }
    return best;
  }
  function indexOfNight(series) {
    for (var i = 0; i < (series || []).length; i++) if (series[i].day === 0) return i;
    return -1;
  }

  return {
    bands: BANDS,
    thresholds: THRESHOLDS,
    sens: SENS,
    recommend: recommend,
    bandIndexFor: bandIndexFor,
    esc: esc
  };
});
