# MyWearIQ

**Qué ropa de ciclismo ponerse para una salida**, a partir del tiempo previsto **a lo largo de
toda la ruta** —no solo en el punto de salida—: temperatura, sensación térmica en bici, viento,
lluvia y altitud, con mapa y gráficas sincronizadas y una pestaña de ropa recomendada.

Aplicación **web estática**: HTML + CSS + JavaScript sin compilación ni servidor propio.
Sin frameworks ni gestores de paquetes: la única dependencia es [Leaflet 1.9.4](https://leafletjs.com/)
copiada en `vendor/`. Funciona en móvil (≥ 360 px) y escritorio, en tema claro y oscuro,
y en español (°C, km/h, mm/h, m, km).

## Uso rápido

La geolocalización exige **HTTPS o `localhost`**. Sirve la carpeta con cualquier servidor estático:

```bash
# con Python (si está instalado)
python3 -m http.server 8000
# o con Node, sin instalar nada
npx serve -l 8000 .
# o con PHP
php -S localhost:8000
```

y abre <http://localhost:8000/index.html>.

- **«Ver ejemplo»** ejecuta el flujo completo con un GPX sintético (bucle de 89,3 km) y una
  previsión simulada. Funciona **sin red** y avisa de que los datos no son reales.
- **En el iPhone**: aloja los ficheros en cualquier servicio estático con HTTPS
  (GitHub Pages, Netlify, Cloudflare Pages…) y ábrelo en Safari → *Compartir* →
  *Añadir a pantalla de inicio*. La app ocupa una pantalla completa y se usa con una mano.

### Pruebas

```bash
node tests/domain.test.js     # → «14 pruebas superadas»
node --check src/services.js  # (idem src/charts.js, src/app.js, src/rules.js, src/domain.js)
```

## Estructura

```
index.html            interfaz (marcado y carga de scripts, en este orden)
styles.css            diseño con tokens CSS, tema claro/oscuro
vendor/leaflet.js     Leaflet 1.9.4
vendor/leaflet.css
src/domain.js         lógica pura, sin DOM ni red (UMD: window.Domain)
src/rules.js          reglas de ropa como datos (window.ClothingRules)
src/services.js       Open-Meteo + caché (window.Services)
src/charts.js         gráficas en canvas con cursor compartido (window.Charts)
src/app.js            estado, eventos y pintado
tests/domain.test.js  pruebas en Node (assert), sin dependencias
```

## Datos externos

| Dato | Servicio | Notas |
| --- | --- | --- |
| Previsión | `api.open-meteo.com/v1/forecast` | Sin clave. **Una sola petición** con todas las coordenadas de la ruta; si el track trae altitud se envía `elevation=` para que el modelo ajuste la temperatura. |
| Búsqueda de lugares | `geocoding-api.open-meteo.com` | Solo al pulsar «Buscar» o Enter (nunca Nominatim). |
| Mapa base | `tile.openstreetmap.org` | Solo visualización; no se precarga ninguna tesela. |

- Caché de 30 minutos en `localStorage` por URL (`mwiq:<url>`), siempre en `try/catch`.
- Límite de uso gratuito (600/min, 5.000/h, 10.000/día, 300.000/mes): los puntos se agrupan
  en una única petición. Si se alcanza el límite, la APP lo dice y sugiere esperar unos minutos.
- **Privacidad**: la ubicación y los tracks no salen del dispositivo; solo se envían a
  Open-Meteo las coordenadas de los puntos muestreados (8–40).
- Atribución visible en el pie: previsión de Open-Meteo.com (CC BY 4.0) y mapa de los
  colaboradores de OpenStreetMap. Uso personal y no comercial.

## Cómo calcula

1. **GPX**: se leen `<trkpt>`/`<rtept>`, se descartan puntos a menos de 1 m, la distancia se
   acumula con haversine y la altitud se suaviza con media móvil centrada
   (ventana `min(5, floor(n/8))`) para obtener un desnivel realista.
2. **Muestreo**: `n = clamp(round(km/3)+1, 8, 40)` puntos equiespaciados por distancia, con
   rumbo y pendiente.
3. **Horas de paso**: 25 km/h en llano (20/30 según el perfil), 38 en descenso (pendiente < −3 %)
   y 700 m/h de velocidad ascensional. Si indicas hora de llegada, todos los tramos se
   reescalan con un único factor.
4. **Sensación en bici**: componente de viento según rumbo y sensación por viento
   (Environment Canada/NWS) con `v = velocidadCiclista + vientoEnContra`;
   por encima de 10 °C se usa la temperatura aparente de Open-Meteo.
5. **Ropa**: franja por sensación media + sensibilidad al frío, más prenda extraíble, lluvia,
   rachas, viento de cara, descensos largos, UV, falta de luz e hielo. Cada decisión se
   explica en «Por qué» con su hora y kilómetro.

Todos los umbrales, las velocidades y los textos de ropa viven en `src/rules.js` como datos
editables; **no se cambian sin avisar al usuario**.

## Desarrollo

- La lógica comprobable está en `src/domain.js` y `src/rules.js`; `domain.js` no toca el DOM
  ni la red, y todo lo que se puede probar va ahí (`tests/domain.test.js`).
- Cualquier texto que llega de una API se inserta con escape HTML.
- Los errores de usuario y de red se muestran en la línea de estado bajo los botones
  (`role="status"`), sin diálogos del navegador.

### Fuera de alcance

Enrutado ciclista automático (hoy línea recta entre salida y destino; candidatos: BRouter,
OpenRouteService), tracks que no sean GPX, catálogo de ropa propia, seguimiento en vivo y
salidas que crucen la medianoche (sin probar).
