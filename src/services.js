/* MyWearIQ · services.js — Open-Meteo + caché en localStorage.
   Sin claves de API. window.Services */
(function (root) {
  'use strict';

  var CACHE_MS = 30 * 60 * 1000;           /* 30 minutos */
  var HOURLY = ['temperature_2m', 'apparent_temperature', 'precipitation',
    'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m',
    'wind_gusts_10m', 'weather_code', 'uv_index', 'is_day'].join(',');

  var MSG_429 = 'Open-Meteo ha alcanzado su límite de uso gratuito. Prueba de nuevo en unos minutos.';
  var MSG_NET = 'No se ha podido contactar con Open-Meteo. Revisa la conexión a internet o «Ver ejemplo» funciona sin red.';

  /* ---- caché (todo acceso a localStorage va en try/catch) ---- */
  function cacheGet(url) {
    try {
      var raw = localStorage.getItem('mwiq:' + url);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || (Date.now() - o.t) > CACHE_MS) return null;
      return o.data;
    } catch (e) { return null; }
  }
  function cacheSet(url, data) {
    try { localStorage.setItem('mwiq:' + url, JSON.stringify({ t: Date.now(), data: data })); }
    catch (e) { /* almacenamiento lleno o no disponible */ }
  }

  function get(url) {
    var hit = cacheGet(url);
    if (hit) return Promise.resolve(hit);
    return fetch(url, { referrerPolicy: 'no-referrer' }).then(function (res) {
      if (res.status === 429) { var e = new Error(MSG_429); e.code = 429; throw e; }
      if (!res.ok) { var e2 = new Error(MSG_NET); e2.code = res.status; throw e2; }
      return res.json();
    }).then(function (json) {
      cacheSet(url, json);
      return json;
    }).catch(function (err) {
      if (err && err.code) throw err;
      var e3 = new Error(MSG_NET); e3.code = 'net'; throw e3;
    });
  }

  function coord(v) { return v == null || !isFinite(v) ? v : Number(Number(v).toFixed(4)); }
  function round(v) { return v == null || !isFinite(v) ? v : Math.round(v); }

  /* Una sola petición con varias coordenadas; la respuesta es lista u objeto. */
  function forecast(opts) {
    var lats = opts.lats, lons = opts.lons;
    if (!lats || !lats.length) return Promise.reject(new Error('Faltan coordenadas de la ruta.'));
    var q = 'latitude=' + lats.map(coord).join(',') +
      '&longitude=' + lons.map(coord).join(',') +
      '&hourly=' + HOURLY +
      '&timezone=auto&wind_speed_unit=kmh' +
      '&start_date=' + opts.start + '&end_date=' + opts.end;
    if (opts.elevations && opts.elevations.length === lats.length) {
      q += '&elevation=' + opts.elevations.map(round).join(',');
    }
    var url = 'https://api.open-meteo.com/v1/forecast?' + q;
    return get(url).then(function (json) {
      var list = Array.isArray(json) ? json : [json];
      if (!list.length || !list[0] || !list[0].hourly) throw new Error(MSG_NET);
      return list.map(function (e) { return e.hourly; });
    });
  }

  /* Búsqueda de lugares (solo al pulsar «Buscar» o Enter; nunca Nominatim). */
  function geocode(name) {
    var q = String(name || '').trim();
    if (!q) return Promise.resolve([]);
    var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
      encodeURIComponent(q) + '&count=6&language=es&format=json';
    return get(url).then(function (json) {
      return (json && Array.isArray(json.results) ? json.results : []).slice(0, 6).map(function (r) {
        return {
          name: r.name, admin1: r.admin1, country: r.country,
          latitude: r.latitude, longitude: r.longitude,
          elevation: r.elevation != null ? r.elevation : null
        };
      });
    });
  }

  root.Services = {
    forecast: forecast,
    geocode: geocode,
    cacheGet: cacheGet,
    cacheSet: cacheSet,
    MSG_429: MSG_429,
    MSG_NET: MSG_NET
  };
})(typeof self !== 'undefined' ? self : this);
