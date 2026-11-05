/* MyWearIQ · rules.js — reglas de ropa como datos.
   UMD: window.ClothingRules / module.exports */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClothingRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Franjas de más calor a más frío. `from` = sensación desde la que se entra.
     `base` = capa base (camiseta interior) de la franja; `extra` = prenda extraíble. */
  var BANDS = [
    { name: 'Calor', from: 25,
      base: null,
      cabeza: 'Casco ventilado, gafas', torso: 'Maillot ligero manga corta',
      manos: null, piernas: 'Culotte corto', pies: 'Calcetín fino', extra: null },
    { name: 'Templado', from: 18,
      base: 'Camiseta interior fina sin mangas',
      cabeza: 'Gafas', torso: 'Maillot manga corta',
      manos: 'Guantes cortos', piernas: 'Culotte corto', pies: 'Calcetín fino',
      extra: 'Manguitos finos' },
    { name: 'Fresco', from: 12,
      base: 'Camiseta interior de manga corta',
      cabeza: 'Gafas', torso: 'Maillot manga corta, manguitos',
      manos: 'Guantes largos finos', piernas: 'Culotte corto o con perneras',
      pies: 'Calcetín medio', extra: 'Chaleco cortavientos' },
    { name: 'Frío', from: 7,
      base: 'Camiseta térmica o de merino de manga corta',
      cabeza: 'Braga de cuello', torso: 'Maillot térmico manga larga, chaleco cortavientos',
      manos: 'Guantes largos medios', piernas: 'Culotte largo o perneras',
      pies: 'Cubrezapatillas finos', extra: 'Cortavientos ligero' },
    { name: 'Muy frío', from: 2,
      base: 'Camiseta térmica de merino de manga larga',
      cabeza: 'Gorro bajo el casco, braga', torso: 'Maillot térmico, chaqueta cortavientos o softshell',
      manos: 'Guantes largos térmicos de invierno', piernas: 'Culotte largo térmico',
      pies: 'Cubrebotas', extra: 'Chaqueta cortavientos o softshell' },
    { name: 'Helada', from: -Infinity,
      base: 'Camiseta térmica de merino de manga larga',
      cabeza: 'Gorro, braga', torso: 'Maillot térmico, chaqueta',
      manos: 'Guantes calefactables o térmicos de invierno', piernas: 'Culotte largo térmico',
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
    iceTemp: 3,              /* °C de temperatura mínima del aire */
    rainProbLow: 20,         /* % de prob. para considerar «tramo con lluvia» */
    rainWindowShare: 0.4,    /* fracción de la ruta bajo la que la lluvia es «localizada» */
    rainWindowDelay: 30,     /* min: si empieza después, el chubasquero va al bolsillo */
    bootFeel: 6              /* sensación < este valor → cubrebotas */
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

  /* Media de sensación ponderada por el tiempo de paso (más minutos, más peso).
     Con muestras equiespaciadas coincide con la media simple. */
  function timeWeightedFeel(series) {
    var n = (series || []).length;
    if (!n) return null;
    if (n === 1) return series[0].feel;
    var acc = 0, wsum = 0;
    for (var i = 0; i < n; i++) {
      var f = series[i].feel;
      if (f == null || !isFinite(f)) continue;
      var t = series[i].t || 0;
      var tPrev = i > 0 ? series[i - 1].t : t;
      var tNext = i < n - 1 ? series[i + 1].t : t;
      var w = (tNext - tPrev) / 2;
      if (!(w > 0)) w = 1;
      acc += f * w; wsum += w;
    }
    return wsum > 0 ? acc / wsum : null;
  }
  /* Primera muestra que alcanza una franja de sensación ≥ from */
  function idxReachFrom(series, from, adj) {
    for (var i = 0; i < (series || []).length; i++) {
      var f = series[i].feel;
      if (f != null && isFinite(f) && f + adj >= from) return i;
    }
    return -1;
  }
  /* Primera muestra que baja de un umbral (se entra en franja más fría) */
  function idxDropBelow(series, from, adj) {
    for (var i = 0; i < (series || []).length; i++) {
      var f = series[i].feel;
      if (f != null && isFinite(f) && f + adj < from) return i;
    }
    return -1;
  }
  /* Prendas que cambian entre dos franjas y son extraíbles. La capa base
     no se cuenta: nunca te quitas la camiseta interior en ruta. */
  function layerDiff(bA, bB) {
    var items = [];
    if (bA.extra && bA.extra !== bB.extra) items.push(bA.extra);
    if (bA.manos && bA.manos !== bB.manos) items.push(bA.manos);
    return items;
  }
  function garmentsOfBand(b) {
    return { cabeza: b.cabeza, base: b.base || null, torso: b.torso,
      manos: b.manos, piernas: b.piernas, pies: b.pies };
  }

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
    var meanW = timeWeightedFeel(series);
    var value = (meanW != null ? meanW : (feel.mean != null ? feel.mean : 0)) + adj;
    var bandIndex = bandIndexFor(value);
    var band = bands[bandIndex];

    var garments = { base: null };
    ZONES.forEach(function (z) { garments[z] = band[z] || null; });
    garments.base = band.base || null;
    var pocket = [], warnings = [], reasons = [];

    /* franja de salida y de llegada (para amplitud térmica) */
    var endFeel = series.length ? series[series.length - 1].feel : null;
    var startFeel2 = (feel.start != null) ? feel.start
      : (series.length ? series[0].feel : null);
    var endBand = (endFeel != null && isFinite(endFeel)) ? bandIndexFor(endFeel + adj) : bandIndex;
    var startBand = (startFeel2 != null && isFinite(startFeel2)) ? bandIndexFor(startFeel2 + adj) : bandIndex;

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

    /* 2b · mucho frío: cubrebotas cuando la sensación baja de 6° (media o mínimo en ruta) */
    var bootMean = value < th.bootFeel;
    var bootMin = feel.min != null && isFinite(feel.min) && (feel.min + adj) < th.bootFeel;
    if (bootMean || bootMin) {
      var pies0 = garments.pies || '';
      addGarment(garments, 'pies', 'Cubrebotas');
      if (garments.pies !== pies0) {
        addReason(reasons, (bootMean
          ? 'Frío en los pies con ' + fmt(value) + '° de sensación media '
          : 'Tramos de menos de ' + th.bootFeel + '° de sensación (mínimo de ' + fmt(feel.min) + '°) ') +
          ': cubrebotas.');
      }
    }

    /* 3 · lluvia (si el tramo lluvioso es corto y llega tarde: chubasquero al bolsillo) */
    var strongRain = (rain.maxProb != null && rain.maxProb >= th.rainStrongPop) ||
      (rain.maxPrecip != null && rain.maxPrecip >= th.rainStrongMm);
    var lightRain = !strongRain && rain.maxProb != null && rain.maxProb >= th.rainLightPop;

    /* ventana de lluvia de la ruta: primera y última muestra con lluvia */
    var rFirst = -1, rLast = -1;
    for (var ri = 0; ri < series.length; ri++) {
      var rPr = series[ri].prob, rPc = series[ri].precip;
      if ((rPr != null && rPr >= th.rainProbLow) || (rPc != null && rPc > 0)) {
        if (rFirst < 0) rFirst = ri;
        rLast = ri;
      }
    }
    var rDur = stats.durationMin != null ? stats.durationMin : (series.length ? series[series.length - 1].t : 0);
    var localized = false;
    if (rFirst >= 0 && rDur > 0) {
      var rT0 = series[rFirst].t || 0;
      var rT1 = series[rLast].t || rT0;
      localized = ((rT1 - rT0) / rDur) < th.rainWindowShare && rT0 >= th.rainWindowDelay;
    }

    if (strongRain && localized) {
      addGarment(garments, 'cabeza', 'Gafas de lente clara');
      addUnique(pocket, 'Chubasquero');
      addUnique(pocket, 'Guardabarros');
      addUnique(pocket, 'Guantes de repuesto');
      addReason(reasons, 'Lluvia localizada entre las ' + at(series, stats, rFirst) +
        ' y las ' + at(series, stats, rLast) + ' (hasta ' + fmt(rain.maxProb) + ' % y ' +
        fmt(rain.maxPrecip) + ' mm/h): chubasquero en el bolsillo, póntelo para ese tramo.');
    } else if (strongRain) {
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

    /* amplitud térmica: la franja de salida no coincide con la de llegada */
    if (startBand !== endBand && series.length) {
      var warms = endBand < startBand;
      var bA = bands[startBand], bB = bands[endBand];
      var crossIdx = warms
        ? idxReachFrom(series, bB.from, adj)
        : idxDropBelow(series, bA.from, adj);
      var changeParts = warms ? layerDiff(bA, bB) : layerDiff(bB, bA);
      var amplitud = [];
      if (changeParts.length) {
        amplitud.push((warms ? 'quítate ' : 'ponte ') + changeParts.join(' · ') +
          (crossIdx >= 0 ? ' hacia las ' + at(series, stats, crossIdx) : ' según avance la ruta'));
      }
      addReason(reasons, 'Amplitud térmica de ' + fmt(Math.abs(endFeel - startFeel2)) +
        '°: sales en franja «' + bA.name + '» y acabas en «' + bB.name + '».' +
        (amplitud.length ? ' ' + amplitud.join('; ') + '.' : ' Ajusta las capas según avances.'));
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

  /* alternatives(stats, series, prefs) — combinaciones de ropa razonables
     (máx. 3) construidas a partir de las franjas de salida y de llegada. */
  function alternatives(stats, series, prefs, rules) {
    rules = rules || { bands: BANDS, thresholds: THRESHOLDS, sens: SENS };
    var bands = rules.bands || BANDS;
    var sensAdj = rules.sens || SENS;
    series = series || [];
    stats = stats || {};
    if (!series.length) return [];
    _dep = (stats.departureMin != null) ? stats.departureMin
      : (series[0] ? series[0].tm - (series[0].t || 0) : null);

    var adj = sensAdj[prefs && prefs.sens] != null ? sensAdj[prefs.sens] : 0;
    var endFeel = series[series.length - 1].feel;
    var startFeel = null;
    if (stats.feel && stats.feel.start != null) startFeel = stats.feel.start;
    else {
      var sSum = 0, sCnt = 0;
      series.forEach(function (s) {
        if ((s.t || 0) <= 30 && s.feel != null) { sSum += s.feel; sCnt++; }
      });
      if (sCnt) startFeel = sSum / sCnt;
    }
    var sBand = (startFeel != null && isFinite(startFeel)) ? bandIndexFor(startFeel + adj) : -1;
    var eBand = (endFeel != null && isFinite(endFeel)) ? bandIndexFor(endFeel + adj) : -1;
    if (sBand < 0 || eBand < 0) return [];

    var list = [];
    function timing(crossIdx) { return crossIdx >= 0 ? at(series, stats, crossIdx) : ''; }

    if (sBand !== eBand) {
      var warms = eBand < sBand;
      var crossIdx = warms
        ? idxReachFrom(series, bands[eBand].from, adj)
        : idxDropBelow(series, bands[sBand].from, adj);

      /* 1 · ropa de salida (fría) que se quita por el camino */
      list.push({
        title: 'Abrigarte al salir y quitarte por el camino',
        garments: garmentsOfBand(bands[sBand]),
        quitar: layerDiff(bands[sBand], bands[eBand]),
        guardar: [],
        when: timing(crossIdx),
        why: 'La ruta va de franja «' + bands[sBand].name + '» a «' + bands[eBand].name +
          '»: sales cómodo en el frío y ' +
          (timing(crossIdx) ? 'a partir de ' + timing(crossIdx) + ' empiezas a quitarte.' : 'vas quitando capas.')
      });

      /* 2 · ropa del final con las capas del principio puestas encima */
      if (warms) {
        var overlays = layerDiff(bands[sBand], bands[eBand]).filter(function (g) {
          return /chaleco|manguito|cortaviento|chaqueta/i.test(g);
        });
        var g2 = garmentsOfBand(bands[eBand]);
        var torsoParts = splitItems(g2.torso);
        overlays.forEach(function (g) {
          var low = g.toLowerCase();
          if (!torsoParts.some(function (p) { return p.toLowerCase() === low; })) torsoParts.push(g);
        });
        g2.torso = torsoParts.join(', ');
        list.push({
          title: 'En ropa del final, con capas del principio encima',
          garments: g2,
          quitar: overlays, guardar: [],
          when: timing(crossIdx),
          why: 'Sales con ' + overlays.join(' y ') + ' sobre el maillot' +
            (timing(crossIdx) ? ', que te quitas a partir de ' + timing(crossIdx) : ', que te quitas al subir la temperatura') + '.'
        });
      }

      /* 3 · ropa templada lo más del tiempo, lo frío en el bolsillo */
      if (!warms) {
        var pocketE = layerDiff(bands[eBand], bands[sBand]);
        list.push({
          title: 'Salir templado y llevar lo frío en el bolsillo',
          garments: garmentsOfBand(bands[sBand]),
          quitar: [], guardar: pocketE,
          when: timing(crossIdx),
          why: 'Pasas la mayor parte en «' + bands[eBand].name + '»' +
            (pocketE.length ? ': sales cómodo y a partir de ' + (timing(crossIdx) || 'el enfriamiento') +
              ' te pones ' + pocketE.join(' y ') + '.' : '.')
        });
      }
    } else {
      var colder = Math.min(sBand + 1, bands.length - 1);
      var warmer = Math.max(sBand - 1, 0);
      var extrasC = layerDiff(bands[colder], bands[sBand]);
      if (colder !== sBand && extrasC.length) {
        list.push({
          title: 'Una capa más de seguridad',
          garments: garmentsOfBand(bands[sBand]),
          quitar: [], guardar: extrasC,
          when: '',
          why: 'Si hace más frío que la previsión (o en los descensos), te pones ' +
            extrasC.join(' y ') + '.'
        });
      }
      var extrasW = layerDiff(bands[sBand], bands[warmer]);
      if (warmer !== sBand && extrasW.length) {
        list.push({
          title: 'Más ligero, quitarte por el camino',
          garments: garmentsOfBand(bands[sBand]),
          quitar: extrasW, guardar: [],
          when: '',
          why: 'Si entra más calor del previsto, quitarte ' + extrasW.join(' y ') +
            ' equivale a vestir de franja «' + bands[warmer].name + '».'
        });
      }
    }
    return list.slice(0, 3);
  }

  return {
    bands: BANDS,
    thresholds: THRESHOLDS,
    sens: SENS,
    recommend: recommend,
    alternatives: alternatives,
    bandIndexFor: bandIndexFor,
    esc: esc
  };
});
