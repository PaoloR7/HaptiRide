# HaptiRide · Landing page + app web

HaptiRide guía al ciclista con **vibraciones del celular**. Cada maniobra tiene su propio ritmo, así no necesita mirar la pantalla ni usar audífonos. En esta etapa no hay hardware: el celular es el dispositivo háptico. El accesorio para el manubrio queda como una etapa futura.

- **Landing page:** `pages/index.html`
- **App web:** `pages/app.html`
- La raíz `index.html` redirige a la landing. GitHub Pages la abre en `https://<usuario>.github.io/<repo>/`.

## Estructura

```
assets/images, assets/icons (logo.svg), assets/fonts
css/styles.css        estilos (landing + app)
css/leaflet.css       estilos del mapa (Leaflet 1.9.4)
js/senales.js         patrones de vibración y configuración (compartido)
js/main.js            landing: menú, probar señales, soporte
js/app.js             app web: panel, mapa, recorrido, historial, perfil, configuración
js/vendor/leaflet.js  librería del mapa
pages/index.html      landing
pages/app.html        app web
docs/README.md
favicon.ico, .gitignore
```

## Tecnologías (sin servidor propio)

| Necesidad | Solución |
|---|---|
| Vibración | Vibration API del navegador (`navigator.vibrate`) |
| Ubicación | Geolocation API (requiere HTTPS, GitHub Pages lo tiene) |
| Pantalla encendida | Screen Wake Lock API |
| Mapa | Leaflet + OpenStreetMap |
| Buscar destino | Nominatim (OpenStreetMap) |
| Rutas en bicicleta | OSRM, perfil bicicleta (routing.openstreetmap.de) |
| Perfil, configuración, historial y solicitudes de soporte | `localStorage` del navegador |

## Patrones de vibración

| Señal | Ritmo |
|---|---|
| Izquierda | 2 pulsos |
| Derecha | 3 pulsos |
| Recto | 1 pulso largo |
| Preaviso de giro (≈90 m antes) | 1 pulso corto |
| Vehículo cercano | 5 pulsos rápidos |
| Llegada | largo · corto · largo |
| Desvío de ruta (más de 40 m) | 3 pulsos largos |
| Señal perdida | 2 pulsos largos |

La configuración cambia la duración de cada pulso (corta, media o larga), las repeticiones (1, 2 o 3) y el intervalo entre pulsos. El navegador no puede cambiar la fuerza del motor, así que la **intensidad** se representa con pulsos más largos o más cortos.

## Confirmación de la vibración

El navegador no puede saber si el celular tiene la vibración apagada: `navigator.vibrate()` responde que vibró aunque el motor no se mueva. Por eso la página pregunta **«¿Sentiste la vibración?»** después de cada prueba hasta que el usuario confirme.

- **No:** se muestran pasos según la marca del celular (Samsung, Xiaomi, Motorola/Pixel, Huawei), más ahorro de batería, No molestar y abrir en Chrome. Botón «Probar de nuevo».
- **Chip de estado:** Vibración sin probar (ámbar) · Vibración lista (verde, solo si confirmó) · Vibración no sentida (rojo).
- **Antes del primer recorrido** se pide probarla en «Antes de salir». No bloquea: si no la confirma, se avisa que las indicaciones solo están aseguradas en pantalla.
- **Durante el recorrido**, si la vibración no está confirmada, cada señal hace parpadear la tarjeta y el modo sin mirar. Se puede probar desde el mismo aviso.

## Dónde está cada HU core (30)

| HU | Título resumido | Dónde |
|---|---|---|
| HU-001 | Panel principal | App · `#panel` |
| HU-002 | Conocer cómo funciona | Landing · Cómo funciona + guía de patrones |
| HU-003 | Elegir perfil de ciclista | App · `#perfil` |
| HU-004 | Propuesta de valor | Landing · Hero (riesgos + botones) |
| HU-013 | Probar patrones antes de salir | Landing · Probar señales |
| HU-014 | Simular aviso de vehículo | App · Recorrido › Simulación de eventos |
| HU-017 | Planificar recorrido | App · `#mapa` |
| HU-018 | Vista previa del recorrido | App · `#mapa` (mapa + alternativas) |
| HU-019 | Próxima maniobra y distancia | App · Recorrido (tarjeta verde) |
| HU-022 | Finalizar y guardar en historial | App · Recorrido › Finalizar; `#historial` |
| HU-023 | Permisos antes de navegar | App · `#permisos` (al tocar Iniciar) |
| HU-024 | Estado de ubicación y vibración | App · chips de la barra superior + `#permisos` |
| HU-025 | Ubicación actual como origen | App · `#mapa` › Mi ubicación (GPS) |
| HU-026 | Modo sin mirar | App · Recorrido › Modo sin mirar |
| HU-028 | Errores de ruta | App · `#mapa` (destino inválido, sin ruta, fallo del servicio) |
| HU-029 | Soporte | Landing · Soporte |
| HU-031 | Navegación con teclado | Landing y app (Tab, foco visible, enlace «Saltar al contenido») |
| HU-032 | Contraste, zoom y responsive | Landing y app |
| HU-033 | Buscar destino | App · `#mapa` › Destino |
| HU-034 | Comparar alternativas | App · `#mapa` › Rutas disponibles |
| HU-035 | Iniciar con la ruta elegida | App · `#mapa` › Iniciar recorrido |
| HU-039 | Maniobra como vibración | App · Recorrido |
| HU-040 | Aviso anticipado | App · Recorrido (preaviso a ≈90 m) |
| HU-041 | Desvío y recalcular | App · Recorrido (desvío > 40 m) |
| HU-042 | Confirmar llegada | App · Recorrido (vibración + diálogo de llegada) |
| HU-043 | Pausar y reanudar | App · Recorrido › Pausar |
| HU-044 | Activar/desactivar señales | App · `#configuracion` |
| HU-045 | Duración, pulsos e intervalo | App · `#configuracion` (resumen + Probar) |
| HU-046 | Intensidad | App · `#configuracion` |
| HU-048 | Pérdida de ubicación o conexión | App · Recorrido (simulada o real) |

## Cómo probarlo

1. **Celular Android con Chrome** (iPhone y computadoras no vibran; ahí las señales se ven en pantalla).
2. Abre el link de GitHub Pages → **Probar señales** para sentir cada patrón.
3. **Abrir la app** → Mapa → *Usar ruta de demostración* → *Iniciar recorrido* → *Continuar al recorrido*.
4. En el recorrido, usa **Simulación de eventos**: velocidad 1x/3x/6x, vehículo, desvío y pérdida de señal.
5. Para un recorrido real: busca un destino, elige la ruta, cambia el modo a **GPS real** y acepta el permiso de ubicación.

Para probar en la computadora, abre la carpeta con una extensión tipo *Live Server* o con `python -m http.server` (no abras el archivo con doble clic, porque algunas funciones del navegador piden `http://` o `https://`).

## Limitaciones conocidas

- La vibración solo funciona con la pantalla encendida y la pestaña abierta. Por eso existe el modo sin mirar, que mantiene la pantalla encendida.
- El celular vibra entero: no puede indicar un lado físico. El lado se distingue por el ritmo.
- El aviso de vehículo es simulado. Detectar vehículos de verdad necesitaría un sensor (etapa futura).
- Nominatim y OSRM son servicios públicos gratuitos con límites de uso. Si no responden, la app ofrece reintentar o usar la ruta de demostración.
