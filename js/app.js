/* =========================================================
   HaptiRide · App web (una sola página con vistas por #hash)
   #panel · #mapa · #permisos · #navegacion · #historial · #perfil · #configuracion
   ========================================================= */
(function () {
  'use strict';
  const S = window.HaptiSenales;
  const $ = function (id) { return document.getElementById(id); };

  /* ---------- Umbrales del recorrido ---------- */
  const PREAVISO_M = 90;      // HU-040: aviso anticipado
  const MANIOBRA_M = 20;      // HU-039: vibración de la maniobra
  const LLEGADA_M = 20;       // HU-042: llegada
  const DESVIO_M = 40;        // HU-041: distancia a la ruta para considerar desvío
  const VELOCIDAD_SIM = 5;    // m/s (≈ 18 km/h)
  const PASO_SIM_MS = 250;

  /* ---------- Servicios externos (gratuitos, sin clave) ---------- */
  const URL_BUSQUEDA = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=pe&accept-language=es&q=';
  const URL_RUTA = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/';
  const ORIGEN_PRUEBA = { lat: -12.12185, lng: -77.02990, nombre: 'Parque Kennedy, Miraflores' };

  // Recorrido de demostración (no depende de internet). Coordenadas aproximadas en Miraflores.
  const RUTA_DEMO = {
    nombre: 'Recorrido de demostración',
    coords: [
      [-12.12185, -77.02990], [-12.12400, -77.03005], [-12.12620, -77.03020],
      [-12.12625, -77.02860], [-12.12630, -77.02700], [-12.12820, -77.02690],
      [-12.13000, -77.02680], [-12.13005, -77.02990]
    ]
  };

  /* ---------- Almacenamiento local ---------- */
  function leer(clave, porDefecto) {
    try { const v = JSON.parse(localStorage.getItem(clave)); return v === null ? porDefecto : v; } catch (e) { return porDefecto; }
  }
  function guardar(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ }
  }

  /* ---------- Utilidades geográficas ---------- */
  function distancia(a, b) { // metros entre [lat,lng]
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function acumuladas(coords) {
    const acc = [0];
    for (let i = 1; i < coords.length; i++) acc.push(acc[i - 1] + distancia(coords[i - 1], coords[i]));
    return acc;
  }
  // Giro en un vértice: producto cruz con x = lng·cos(lat), y = lat. cruz > 0 → izquierda
  function giroEn(a, b, c) {
    const k = Math.cos(b[0] * Math.PI / 180);
    const v1 = [(b[1] - a[1]) * k, b[0] - a[0]], v2 = [(c[1] - b[1]) * k, c[0] - b[0]];
    const cruz = v1[0] * v2[1] - v1[1] * v2[0];
    const punto = v1[0] * v2[0] + v1[1] * v2[1];
    const angulo = Math.abs(Math.atan2(cruz, punto)) * 180 / Math.PI;
    if (angulo < 30) return 'recto';
    return cruz > 0 ? 'izquierda' : 'derecha';
  }
  // Proyecta un punto sobre la ruta: devuelve { s: metros recorridos, desvio: metros a la ruta }
  function proyectar(punto, ruta) {
    const k = Math.cos(punto[0] * Math.PI / 180) * 111320, m = 110540;
    let mejor = { s: 0, desvio: Infinity };
    for (let i = 0; i < ruta.coords.length - 1; i++) {
      const a = ruta.coords[i], b = ruta.coords[i + 1];
      const ax = (a[1] - punto[1]) * k, ay = (a[0] - punto[0]) * m;
      const bx = (b[1] - punto[1]) * k, by = (b[0] - punto[0]) * m;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.sqrt(px * px + py * py);
      if (d < mejor.desvio) mejor = { s: ruta.acc[i] + t * (ruta.acc[i + 1] - ruta.acc[i]), desvio: d };
    }
    return mejor;
  }
  function puntoEn(ruta, s) {
    const acc = ruta.acc;
    if (s <= 0) return ruta.coords[0].slice();
    if (s >= ruta.total) return ruta.coords[ruta.coords.length - 1].slice();
    let i = 1;
    while (acc[i] < s) i++;
    const t = (s - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
    const a = ruta.coords[i - 1], b = ruta.coords[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  function desplazar(p, metrosNorte, metrosEste) {
    return [p[0] + metrosNorte / 110540, p[1] + metrosEste / (111320 * Math.cos(p[0] * Math.PI / 180))];
  }
  function indiceCercano(coords, punto, desde) {
    let mejor = desde || 0, dMin = Infinity;
    for (let i = desde || 0; i < coords.length; i++) {
      const d = distancia(coords[i], punto);
      if (d < dMin) { dMin = d; mejor = i; }
    }
    return mejor;
  }

  /* ---------- Formatos ---------- */
  function fDist(m) {
    if (m < 1000) return Math.max(0, Math.round(m / 10) * 10) + ' m';
    return (m / 1000).toFixed(1).replace('.', ',') + ' km';
  }
  function fTiempo(seg) {
    const min = Math.max(1, Math.round(seg / 60));
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }
  function fFecha(iso) {
    return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- Avisos breves ---------- */
  let tToast;
  function toast(texto) {
    const t = $('toast');
    t.textContent = texto; t.hidden = false;
    clearTimeout(tToast);
    tToast = setTimeout(function () { t.hidden = true; }, texto.length > 70 ? 6000 : 3200);
  }

  /* ---------- Diálogo accesible ---------- */
  let focoPrevio = null;
  function dialogo(titulo, texto, acciones, cerrable) {
    focoPrevio = document.activeElement;
    $('dialogo').dataset.cerrable = cerrable === false ? 'no' : 'si';
    $('dialogo-titulo').textContent = titulo;
    $('dialogo-texto').textContent = texto;
    const cont = $('dialogo-acciones');
    cont.innerHTML = '';
    acciones.forEach(function (a) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.clase || 'btn--secundario');
      b.textContent = a.texto;
      b.addEventListener('click', function () { cerrarDialogo(); if (a.accion) a.accion(); });
      cont.appendChild(b);
    });
    $('dialogo').hidden = false;
    cont.querySelector('button').focus();
  }
  function cerrarDialogo() {
    $('dialogo').hidden = true;
    if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('dialogo').hidden && $('dialogo').dataset.cerrable !== 'no') cerrarDialogo();
    // Mantener el foco dentro del diálogo
    if (e.key === 'Tab' && !$('dialogo').hidden) {
      const bs = $('dialogo').querySelectorAll('button');
      const primero = bs[0], ultimo = bs[bs.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  });

  /* =========================================================
     Estado del sistema (HU-024) y permisos (HU-023)
     ========================================================= */
  const sistema = { ubicacion: 'desconocida', enLinea: navigator.onLine };

  function pintarChip(el, clase, texto) {
    el.className = 'chip chip--' + clase;
    const corto = { 'chip-ubicacion': 'Ubicación', 'chip-vibracion': 'Vibración', 'chip-conexion': 'Red' }[el.id];
    el.innerHTML = '<span class="chip__largo">' + texto + '</span><span class="chip__corto" aria-hidden="true">' + corto + '</span>';
    el.title = texto;
    el.setAttribute('aria-label', el.id.replace('chip-', '') + ': ' + texto + '. Ver permisos');
  }
  function actualizarEstado() {
    const cfg = S.leerConfig();
    const textoUbic = {
      desconocida: ['aviso', 'Ubicación: sin revisar'], concedida: ['ok', 'Ubicación activa'],
      denegada: ['error', 'Ubicación bloqueada'], sinsenal: ['error', 'Sin señal GPS'],
      simulada: ['ok', 'Ubicación simulada'], nodisponible: ['error', 'Sin GPS']
    }[sistema.ubicacion];
    pintarChip($('chip-ubicacion'), textoUbic[0], textoUbic[1]);
    if (!S.puedeVibrar) pintarChip($('chip-vibracion'), 'error', 'Sin vibración');
    else if (!cfg.activas) pintarChip($('chip-vibracion'), 'aviso', 'Vibración apagada');
    else pintarChip($('chip-vibracion'), 'ok', 'Vibración lista');
    pintarChip($('chip-conexion'), sistema.enLinea ? 'ok' : 'error', sistema.enLinea ? 'En línea' : 'Sin conexión');
    pintarPermisos();
  }

  function revisarPermisoUbicacion() {
    if (!('geolocation' in navigator)) { sistema.ubicacion = 'nodisponible'; actualizarEstado(); return; }
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
        if (p.state === 'granted') sistema.ubicacion = 'concedida';
        else if (p.state === 'denied') sistema.ubicacion = 'denegada';
        if (recorrido && recorrido.modo === 'simulacion') sistema.ubicacion = 'simulada';
        actualizarEstado();
        p.onchange = revisarPermisoUbicacion;
      }).catch(function () { actualizarEstado(); });
    } else actualizarEstado();
  }

  // Instrucciones según el sistema: cada uno desbloquea la ubicación en un lugar distinto
  const ES_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ES_ANDROID = /Android/.test(navigator.userAgent);
  function comoActivarUbicacion() {
    if (ES_IOS) return 'En iPhone: 1) Ajustes › Privacidad y seguridad › Localización: actívala y en «Sitios web de Safari» (o en Chrome, si usas Chrome) elige «Al usar la app». 2) En Safari toca «aA» › Ajustes del sitio web › Ubicación › «Preguntar». 3) Recarga la página.';
    if (ES_ANDROID) return 'En Android: toca el ícono a la izquierda de la dirección › Permisos (o Configuración del sitio) › Ubicación › Permitir. Revisa también que la ubicación del celular esté encendida. Luego recarga la página.';
    return 'Actívala desde el ícono del candado, a la izquierda de la dirección, y recarga la página.';
  }

  function pintarPermisos() {
    const u = $('permiso-ubicacion-texto');
    const bU = $('permiso-ubicacion');
    const textos = {
      desconocida: 'Aún no has dado permiso. Es necesario para el modo GPS real.',
      concedida: 'Permitida. HaptiRide puede seguir tu posición durante el recorrido.',
      simulada: 'En simulación no se usa tu ubicación real.',
      denegada: 'Bloqueada. ' + comoActivarUbicacion(),
      sinsenal: 'Permitida, pero no hay señal GPS en este momento.',
      nodisponible: 'Este navegador no ofrece ubicación.'
    };
    u.textContent = textos[sistema.ubicacion];
    bU.hidden = sistema.ubicacion === 'concedida' || sistema.ubicacion === 'nodisponible';
    // Si ya está bloqueada, el navegador no vuelve a preguntar: el botón sirve para reintentar después de cambiar los ajustes
    if (!bU.disabled) bU.textContent = sistema.ubicacion === 'denegada' ? 'Ya la activé, volver a intentar' : 'Permitir ubicación';
    const cfg = S.leerConfig();
    $('permiso-vibracion-texto').textContent = !S.puedeVibrar
      ? 'Este navegador no puede vibrar (iPhone o computadora). Verás las señales en pantalla. Para sentirlas usa Chrome en Android.'
      : (cfg.activas ? 'Disponible. Toca «Probar vibración» para comprobarlo.' : 'Disponible, pero desactivada en Configuración.');
    $('permiso-pantalla-texto').textContent = ('wakeLock' in navigator)
      ? 'El modo sin mirar mantendrá la pantalla encendida (necesario para que el navegador siga vibrando).'
      : 'Este navegador no puede mantener la pantalla encendida: desactiva el bloqueo automático mientras pedaleas.';
    $('permiso-conexion-texto').textContent = sistema.enLinea
      ? 'En línea. El mapa y el cálculo de rutas funcionan.'
      : 'Sin conexión. Puedes usar la ruta de demostración; el mapa de fondo puede no cargar.';
  }

  $('permiso-ubicacion').addEventListener('click', function () {
    const boton = this;
    boton.disabled = true; boton.textContent = 'Pidiendo ubicación…';
    pedirUbicacion().then(function () { toast('Ubicación permitida'); }).catch(function (err) {
      // Si el permiso ya fue rechazado, el navegador no vuelve a preguntar: hay que explicarlo
      toast(err && err.code === 1 ? 'El navegador tiene la ubicación bloqueada. Sigue los pasos que aparecen arriba.' : 'No se pudo obtener la ubicación. Revisa que el GPS esté encendido.');
    }).then(function () { boton.disabled = false; pintarPermisos(); });
  });
  $('permiso-vibracion').addEventListener('click', function () {
    const r = S.reproducir('derecha');
    toast(r.vibro ? 'Vibrando: girar a la derecha (3 pulsos)' : 'Este navegador no vibró; verás las señales en pantalla');
  });

  function pedirUbicacion() {
    return new Promise(function (ok, mal) {
      if (!('geolocation' in navigator)) { sistema.ubicacion = 'nodisponible'; actualizarEstado(); mal(new Error('nodisponible')); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        sistema.ubicacion = 'concedida'; actualizarEstado();
        ok([pos.coords.latitude, pos.coords.longitude]);
      }, function (err) {
        sistema.ubicacion = err.code === 1 ? 'denegada' : 'sinsenal';
        actualizarEstado();
        mal(err);
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
    });
  }

  window.addEventListener('online', function () { sistema.enLinea = true; actualizarEstado(); alRecuperarConexion(); });
  window.addEventListener('offline', function () { sistema.enLinea = false; actualizarEstado(); alPerderConexion(); });

  /* =========================================================
     Router por #hash
     ========================================================= */
  const VISTAS = ['panel', 'mapa', 'permisos', 'navegacion', 'historial', 'perfil', 'configuracion'];
  const TITULOS = { panel: 'Panel', mapa: 'Planificar recorrido', permisos: 'Permisos', navegacion: 'Recorrido', historial: 'Historial', perfil: 'Perfil', configuracion: 'Configuración' };
  function mostrarVista() {
    let v = location.hash.replace('#', '') || 'panel';
    if (VISTAS.indexOf(v) < 0) v = 'panel';
    if (v === 'navegacion' && !recorrido) { location.replace('#mapa'); return; }
    VISTAS.forEach(function (n) { $('vista-' + n).hidden = n !== v; });
    document.querySelectorAll('.tabbar a').forEach(function (a) {
      if (a.dataset.tab === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = 'HaptiRide · ' + TITULOS[v];
    if (v === 'panel') pintarPanel();
    if (v === 'mapa') iniciarMapaPlan();
    if (v === 'permisos') { $('permisos-continuar').hidden = !pendienteIniciar; revisarPermisoUbicacion(); }
    if (v === 'navegacion') iniciarMapaNav();
    if (v === 'historial') pintarHistorial();
    if (v === 'perfil') pintarPerfil();
    if (v === 'configuracion') pintarConfig();
    window.scrollTo(0, 0);
    if (yaIniciado) $('app-principal').focus({ preventScroll: true }); // al cambiar de vista, el foco pasa al contenido
    yaIniciado = true;
  }
  let yaIniciado = false;
  window.addEventListener('hashchange', mostrarVista);

  /* =========================================================
     HU-001 · Panel principal
     ========================================================= */
  const PERFILES = { urbano: 'Ciclista urbano', repartidor: 'Repartidor', compartida: 'Bicicleta compartida' };
  function pintarPanel() {
    const perfil = leer('haptiride-perfil', null);
    $('saludo-perfil').textContent = perfil ? ' · ' + PERFILES[perfil] : '';
    const hist = leer('haptiride-historial', []);
    const cont = $('ultima-actividad');
    if (!hist.length) {
      cont.innerHTML = '<div class="tarjeta vacio"><span class="ico" aria-hidden="true">🚲</span>' +
        '<p><strong>Aún no tienes recorridos guardados.</strong></p>' +
        '<p class="texto-suave">Planifica tu primer recorrido para verlo aquí.</p>' +
        '<a class="btn btn--primario" href="#mapa">Planificar recorrido</a></div>';
      return;
    }
    const u = hist[hist.length - 1];
    cont.innerHTML = '<div class="tarjeta"><div class="historial-item"><div><strong>' + esc(u.destino) + '</strong>' +
      '<div class="dato-fila"><span>' + fFecha(u.fecha) + '</span><span>' + fDist(u.distancia) + '</span><span>' + fTiempo(u.duracion) + '</span></div></div>' +
      '<span class="insignia ' + (u.estado === 'Completado' ? 'insignia--ok' : '') + '">' + esc(u.estado) + '</span></div>' +
      '<a class="btn btn--secundario btn--sm" style="margin-top:1rem" href="#historial">Ver historial</a></div>';
  }

  /* =========================================================
     HU-003 · Perfil
     ========================================================= */
  function pintarPerfil() {
    const actual = leer('haptiride-perfil', null);
    document.querySelectorAll('[data-perfil]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.perfil === actual)); });
    $('estado-perfil').textContent = actual ? 'Perfil guardado: ' + PERFILES[actual] + '.' : 'Todavía no has elegido un perfil.';
  }
  document.querySelectorAll('[data-perfil]').forEach(function (b) {
    b.addEventListener('click', function () {
      guardar('haptiride-perfil', b.dataset.perfil);
      pintarPerfil();
      const n = leer('haptiride-historial', []).length;
      $('estado-perfil').textContent = 'Perfil guardado: ' + PERFILES[b.dataset.perfil] + '. Tu historial se mantiene (' + n + (n === 1 ? ' recorrido' : ' recorridos') + ').';
    });
  });

  /* =========================================================
     HU-044, HU-045, HU-046 · Configuración de señales
     ========================================================= */
  const NOMBRES_CFG = {
    intensidad: { baja: 'baja', media: 'media', alta: 'alta' },
    duracion: { corta: 'corta', media: 'media', larga: 'larga' },
    intervalo: { corto: 'corto', medio: 'medio', largo: 'largo' }
  };
  function pintarConfig() {
    const c = S.leerConfig();
    $('cfg-activas').checked = c.activas;
    document.querySelectorAll('[data-cfg]').forEach(function (grupo) {
      const clave = grupo.dataset.cfg;
      grupo.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(String(c[clave]) === b.dataset.valor));
        b.disabled = !c.activas;
      });
    });
    $('cfg-probar').disabled = !c.activas;
    $('cfg-resumen').textContent = c.activas
      ? 'Señales activadas · intensidad ' + NOMBRES_CFG.intensidad[c.intensidad] + ' · duración ' + NOMBRES_CFG.duracion[c.duracion] +
        ' · ' + c.pulsos + (Number(c.pulsos) === 1 ? ' repetición' : ' repeticiones') + ' · intervalo ' + NOMBRES_CFG.intervalo[c.intervalo] + '.'
      : 'Señales desactivadas. Durante el recorrido verás las indicaciones solo en pantalla.';
    $('cfg-aviso').textContent = S.puedeVibrar ? '' : 'Este navegador no puede vibrar: al probar verás la señal en pantalla. Para sentirla usa Chrome en Android.';
    actualizarEstado();
  }
  $('cfg-activas').addEventListener('change', function () {
    const c = S.leerConfig(); c.activas = this.checked; S.guardarConfig(c);
    if (!c.activas) S.detener();
    pintarConfig();
    toast(c.activas ? 'Señales de vibración activadas' : 'Señales de vibración desactivadas');
  });
  document.querySelectorAll('[data-cfg]').forEach(function (grupo) {
    grupo.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        const c = S.leerConfig();
        c[grupo.dataset.cfg] = grupo.dataset.cfg === 'pulsos' ? Number(b.dataset.valor) : b.dataset.valor;
        S.guardarConfig(c); pintarConfig();
      });
    });
  });
  $('cfg-probar').addEventListener('click', function () {
    const tipo = $('cfg-probar-tipo').value;
    const r = S.reproducir(tipo);
    toast(S.PATRONES[tipo].nombre + (r.vibro ? ' · vibrando' : ' · solo en pantalla'));
  });
  $('cfg-restablecer').addEventListener('click', function () {
    S.guardarConfig(Object.assign({}, S.CONFIG_INICIAL)); pintarConfig(); toast('Configuración restablecida');
  });

  /* =========================================================
     HU-022 · Historial
     ========================================================= */
  function pintarHistorial() {
    const hist = leer('haptiride-historial', []).slice().reverse();
    const cont = $('lista-historial');
    if (!hist.length) {
      cont.innerHTML = '<div class="tarjeta vacio"><span class="ico" aria-hidden="true">☰</span><p><strong>Tu historial está vacío.</strong></p>' +
        '<p class="texto-suave">Cuando finalices un recorrido se guardará aquí con la fecha, el destino y sus datos.</p><a class="btn btn--primario" href="#mapa">Planificar recorrido</a></div>';
      return;
    }
    cont.innerHTML = hist.map(function (h) {
      return '<article class="tarjeta historial-item"><div><h2 style="font-size:1.05rem;margin:0">' + esc(h.destino) + '</h2>' +
        '<div class="dato-fila"><span>' + fFecha(h.fecha) + '</span><span>Distancia: <strong>' + fDist(h.distancia) + '</strong></span>' +
        '<span>Tiempo: <strong>' + fTiempo(h.duracion) + '</strong></span><span>Señales: <strong>' + h.senales + '</strong></span><span>' + esc(h.modo) + '</span></div></div>' +
        '<span class="insignia ' + (h.estado === 'Completado' ? 'insignia--ok' : '') + '">' + esc(h.estado) + '</span></article>';
    }).join('');
  }

  /* =========================================================
     Mapas (Leaflet + OpenStreetMap)
     ========================================================= */
  function crearMapa(id) {
    const m = L.map(id, { zoomControl: true, attributionControl: true }).setView([ORIGEN_PRUEBA.lat, ORIGEN_PRUEBA.lng], 15);
    // Fuente del mapa:
    // - Desde GitHub Pages o Live Server (http/https): mapa estándar de OpenStreetMap.
    // - Si se abre el archivo con doble clic (file://), OpenStreetMap bloquea las imágenes
    //   porque no recibe la página de origen; en ese caso se usa el mapa de Esri.
    const OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', op: {
      maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '© colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } };
    const ESRI = { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', op: {
      maxZoom: 19, maxNativeZoom: 19, attribution: 'Mapa © Esri, HERE, Garmin, © colaboradores de OpenStreetMap' } };
    const desdeArchivo = location.protocol === 'file:';
    const base = desdeArchivo ? ESRI : OSM;
    const capa = L.tileLayer(base.url, base.op).addTo(m);
    // Respaldo: si la fuente principal falla varias veces, se cambia a la otra
    let fallos = 0;
    capa.on('tileerror', function () {
      if (++fallos !== 4) return;
      m.removeLayer(capa);
      const otra = base === OSM ? ESRI : OSM;
      L.tileLayer(otra.url, otra.op).addTo(m);
    });
    return m;
  }
  function icono(clase) { return L.divIcon({ className: '', html: '<div class="' + clase + '"></div>', iconSize: [26, 26], iconAnchor: [13, 13] }); }

  let mapaPlan = null, capaPlan = null;
  function iniciarMapaPlan() {
    if (typeof L === 'undefined') { $('mapa-plan').textContent = 'No se pudo cargar el mapa.'; return; }
    if (!mapaPlan) { mapaPlan = crearMapa('mapa-plan'); capaPlan = L.layerGroup().addTo(mapaPlan); }
    setTimeout(function () { mapaPlan.invalidateSize(); pintarPlan(); }, 50);
  }

  /* =========================================================
     HU-017, 018, 025, 028, 033, 034, 035 · Planificar
     ========================================================= */
  const plan = {
    origenTipo: 'demo',
    origen: [ORIGEN_PRUEBA.lat, ORIGEN_PRUEBA.lng],
    origenNombre: ORIGEN_PRUEBA.nombre,
    destino: null,          // { coords, nombre }
    rutas: [],              // alternativas
    elegida: -1,
    modo: 'simulacion',
    ultimaAccion: null      // para «Reintentar»
  };

  function seleccionarEn(grupo, attr, valor) {
    document.querySelectorAll('[' + attr + ']').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute(attr) === valor)); });
  }

  // Origen: punto de prueba o GPS (HU-025)
  document.querySelectorAll('[data-origen]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.origen === 'demo') {
        plan.origenTipo = 'demo';
        plan.origen = [ORIGEN_PRUEBA.lat, ORIGEN_PRUEBA.lng];
        plan.origenNombre = ORIGEN_PRUEBA.nombre;
        seleccionarEn(null, 'data-origen', 'demo');
        $('texto-origen').textContent = ORIGEN_PRUEBA.nombre + ' (punto fijo para pruebas).';
        limpiarRutas(); pintarPlan();
        return;
      }
      $('texto-origen').textContent = 'Buscando tu ubicación…';
      pedirUbicacion().then(function (p) {
        plan.origenTipo = 'gps'; plan.origen = p; plan.origenNombre = 'Mi ubicación';
        seleccionarEn(null, 'data-origen', 'gps');
        $('texto-origen').textContent = 'Mi ubicación actual (precisión del GPS del celular).';
        limpiarRutas(); pintarPlan();
        if (mapaPlan) mapaPlan.setView(p, 16);
      }).catch(function (err) {
        seleccionarEn(null, 'data-origen', plan.origenTipo);
        $('texto-origen').textContent = err && err.code === 1
          ? 'No diste permiso de ubicación. Seguimos con el punto de prueba. Puedes activarlo en Permisos.'
          : 'No pudimos obtener tu ubicación. Seguimos con el punto de prueba.';
      });
    });
  });

  // Modo del recorrido
  document.querySelectorAll('[data-modo]').forEach(function (b) {
    b.addEventListener('click', function () {
      plan.modo = b.dataset.modo;
      seleccionarEn(null, 'data-modo', plan.modo);
      $('texto-modo').textContent = plan.modo === 'simulacion'
        ? 'La bicicleta avanza sola por la ruta. Úsalo para practicar y para las pruebas con usuarios.'
        : 'Se usa el GPS del celular mientras pedaleas. Necesita permiso de ubicación y la pantalla encendida.';
      pintarBotonIniciar();
    });
  });

  function limpiarRutas() { plan.rutas = []; plan.elegida = -1; $('bloque-alternativas').hidden = true; pintarBotonIniciar(); }

  // HU-028 · Errores con acciones, sin perder lo escrito
  function mostrarError(tipo, detalle) {
    const textos = {
      invalido: ['No encontramos ese destino', 'Revisa cómo está escrito o prueba con una dirección más específica (calle y distrito).'],
      vacio: ['Escribe un destino', 'Ingresa el nombre de un lugar o una dirección para buscarlo.'],
      sinruta: ['No hay una ruta en bicicleta', 'El proveedor no encontró un camino en bicicleta entre el origen y ese destino. Prueba con otro destino cercano.'],
      proveedor: ['El servicio de mapas no respondió', 'Puede ser tu conexión o el servicio externo. Tus datos se mantienen; puedes reintentar.'],
      sinconexion: ['Estás sin conexión', 'Para buscar destinos y calcular rutas necesitas internet. Mientras tanto, puedes practicar con la ruta de demostración.']
    }[tipo];
    let acciones = '';
    if (tipo === 'invalido' || tipo === 'vacio') acciones = '<button class="btn btn--secundario btn--sm" data-err="corregir">Corregir destino</button>';
    if (tipo === 'sinruta') acciones = '<button class="btn btn--secundario btn--sm" data-err="corregir">Elegir otro destino</button>';
    if (tipo === 'proveedor' || tipo === 'sinconexion') acciones = '<button class="btn btn--primario btn--sm" data-err="reintentar">Reintentar</button>';
    if (tipo !== 'vacio') acciones += ' <button class="btn btn--secundario btn--sm" data-err="demo">Usar ruta de demostración</button>';
    $('error-ruta').innerHTML = '<div class="aviso aviso--rojo"><strong>' + textos[0] + '</strong><p style="margin:.25rem 0 .75rem">' + textos[1] +
      (detalle ? ' <span class="texto-suave">(' + esc(detalle) + ')</span>' : '') + '</p>' + acciones + '</div>';
    $('error-ruta').querySelectorAll('[data-err]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.err === 'corregir') { $('destino').focus(); $('destino').select(); }
        if (b.dataset.err === 'reintentar' && plan.ultimaAccion) plan.ultimaAccion();
        if (b.dataset.err === 'demo') usarDemo();
      });
    });
  }
  function limpiarError() { $('error-ruta').innerHTML = ''; }

  function pedirJSON(url, msLimite) {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const t = setTimeout(function () { if (ctrl) ctrl.abort(); }, msLimite || 12000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, headers: { 'Accept': 'application/json' } })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(function (e) { clearTimeout(t); throw e; });
  }

  // HU-033 · Buscar un destino
  $('form-destino').addEventListener('submit', function (e) {
    e.preventDefault();
    buscarDestino();
  });
  function buscarDestino() {
    const q = $('destino').value.trim();
    $('resultados').hidden = true;
    limpiarError();
    if (!q) { mostrarError('vacio'); $('destino').focus(); return; }
    if (!navigator.onLine) { plan.ultimaAccion = buscarDestino; mostrarError('sinconexion'); return; }
    plan.ultimaAccion = buscarDestino;
    $('ayuda-destino').textContent = 'Buscando «' + q + '»…';
    pedirJSON(URL_BUSQUEDA + encodeURIComponent(q)).then(function (lista) {
      $('ayuda-destino').textContent = 'Busca un lugar en Perú. Necesitas conexión a internet.';
      if (!lista.length) { mostrarError('invalido'); return; }
      const ul = $('resultados');
      ul.innerHTML = '';
      lista.forEach(function (r) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = r.display_name;
        b.addEventListener('click', function () {
          ul.hidden = true;
          const nombre = r.display_name.split(',').slice(0, 2).join(',').trim();
          $('destino').value = nombre;
          plan.destino = { coords: [Number(r.lat), Number(r.lon)], nombre: nombre };
          calcularRutas();
        });
        li.appendChild(b); ul.appendChild(li);
      });
      ul.hidden = false;
      ul.querySelector('button').focus();
    }).catch(function (err) {
      $('ayuda-destino').textContent = 'Busca un lugar en Perú. Necesitas conexión a internet.';
      mostrarError('proveedor', err.message);
    });
  }

  // HU-018, HU-034 · Calcular rutas reales (OSRM, perfil bicicleta)
  function calcularRutas() {
    limpiarError(); limpiarRutas();
    if (!plan.destino) return;
    if (!navigator.onLine) { plan.ultimaAccion = calcularRutas; mostrarError('sinconexion'); return; }
    plan.ultimaAccion = calcularRutas;
    $('nota-alternativas').textContent = 'Calculando rutas…';
    const o = plan.origen, d = plan.destino.coords;
    const url = URL_RUTA + o[1] + ',' + o[0] + ';' + d[1] + ',' + d[0] + '?overview=full&geometries=geojson&steps=true&alternatives=true';
    pedirJSON(url, 15000).then(function (res) {
      if (res.code === 'NoRoute' || !res.routes || !res.routes.length) { mostrarError('sinruta'); pintarPlan(); return; }
      if (res.code !== 'Ok') { mostrarError('proveedor', res.code); return; }
      plan.rutas = res.routes.map(function (r, i) { return rutaDesdeOSRM(r, i, plan.destino.nombre); });
      plan.elegida = 0;
      pintarAlternativas(); pintarPlan();
    }).catch(function (err) { mostrarError('proveedor', err.message); });
  }

  function textoManiobra(tipo, calle) {
    const base = { izquierda: 'Gira a la izquierda', derecha: 'Gira a la derecha', recto: 'Continúa recto', llegada: 'Llegas a tu destino' }[tipo];
    if (tipo === 'llegada') return base;
    return base + (calle ? (tipo === 'recto' ? ' por ' : ' en ') + calle : '');
  }

  function prepararRuta(r) {
    r.acc = acumuladas(r.coords);
    r.total = r.acc[r.acc.length - 1];
    r.maniobras.push({ idx: r.coords.length - 1, s: r.total, tipo: 'llegada', texto: 'Llegas a tu destino' });
    r.maniobras.forEach(function (m) { if (m.s === undefined) m.s = r.acc[m.idx]; });
    return r;
  }

  function rutaDesdeOSRM(r, i, destinoNombre) {
    const coords = r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
    const maniobras = [];
    let desde = 0;
    (r.legs[0].steps || []).forEach(function (st) {
      const t = st.maneuver.type, mod = st.maneuver.modifier || '';
      if (t === 'depart' || t === 'arrive') return;
      let tipo = null;
      if (mod.indexOf('left') >= 0) tipo = 'izquierda';
      else if (mod.indexOf('right') >= 0) tipo = 'derecha';
      else if (mod === 'uturn') tipo = 'izquierda';
      else if (mod === 'straight' && (t === 'continue' || t === 'fork' || t === 'roundabout' || t === 'rotary')) tipo = 'recto';
      if (!tipo) return;
      const punto = [st.maneuver.location[1], st.maneuver.location[0]];
      const idx = indiceCercano(coords, punto, desde);
      desde = idx;
      maniobras.push({ idx: idx, tipo: tipo, texto: mod === 'uturn' ? 'Da la vuelta' : textoManiobra(tipo, st.name) });
    });
    return prepararRuta({
      nombre: i === 0 ? 'Ruta recomendada' : 'Alternativa ' + i,
      destino: destinoNombre, coords: coords, maniobras: maniobras,
      distancia: r.distance, duracion: r.duration, fuente: 'osrm'
    });
  }

  function construirDemo() {
    const coords = RUTA_DEMO.coords.map(function (c) { return c.slice(); });
    const maniobras = [];
    for (let i = 1; i < coords.length - 1; i++) {
      const tipo = giroEn(coords[i - 1], coords[i], coords[i + 1]);
      maniobras.push({ idx: i, tipo: tipo, texto: tipo === 'recto' ? 'Continúa recto en el cruce' : textoManiobra(tipo, '') + ' en el cruce' });
    }
    const r = prepararRuta({ nombre: RUTA_DEMO.nombre, destino: 'Destino de demostración (Miraflores)', coords: coords, maniobras: maniobras, fuente: 'demo' });
    r.distancia = r.total;
    r.duracion = r.total / VELOCIDAD_SIM;
    return r;
  }

  function usarDemo() {
    limpiarError();
    $('resultados').hidden = true;
    plan.origenTipo = 'demo';
    plan.origen = RUTA_DEMO.coords[0].slice();
    plan.origenNombre = ORIGEN_PRUEBA.nombre;
    seleccionarEn(null, 'data-origen', 'demo');
    $('texto-origen').textContent = ORIGEN_PRUEBA.nombre + ' (punto fijo para pruebas).';
    plan.destino = { coords: RUTA_DEMO.coords[RUTA_DEMO.coords.length - 1], nombre: 'Destino de demostración (Miraflores)' };
    plan.rutas = [construirDemo()];
    plan.elegida = 0;
    pintarAlternativas(); pintarPlan();
  }
  $('usar-demo').addEventListener('click', usarDemo);

  function pintarAlternativas() {
    const cont = $('alternativas');
    cont.innerHTML = '';
    $('bloque-alternativas').hidden = !plan.rutas.length;
    if (!plan.rutas.length) return;
    const demo = plan.rutas[0].fuente === 'demo';
    $('nota-alternativas').textContent = demo
      ? 'Ruta simulada para practicar: no corresponde a un cálculo real de calles.'
      : (plan.rutas.length === 1 ? 'El proveedor de rutas devolvió una sola opción para este trayecto.' : 'Elige la ruta que prefieras. Duración estimada en bicicleta.');
    plan.rutas.forEach(function (r, i) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'alternativa';
      b.setAttribute('aria-pressed', String(i === plan.elegida));
      const giros = r.maniobras.filter(function (m) { return m.tipo === 'izquierda' || m.tipo === 'derecha'; }).length;
      b.innerHTML = '<span><span class="titulo">' + esc(r.nombre) + (i === plan.elegida ? ' · elegida' : '') + '</span><br><span class="meta">' + giros + ' giros</span></span>' +
        '<span style="text-align:right"><strong>' + fTiempo(r.duracion) + '</strong><br><span class="meta">' + fDist(r.distancia) + '</span></span>';
      b.addEventListener('click', function () { plan.elegida = i; pintarAlternativas(); pintarPlan(); cont.children[i].focus(); });
      cont.appendChild(b);
    });
    pintarBotonIniciar();
  }

  function pintarPlan() {
    if (!mapaPlan) return;
    capaPlan.clearLayers();
    L.marker(plan.origen, { icon: icono('marcador-punto marcador-punto--origen'), title: 'Origen', keyboard: false }).addTo(capaPlan);
    if (plan.destino) L.marker(plan.destino.coords, { icon: icono('marcador-punto marcador-punto--destino'), title: 'Destino', keyboard: false }).addTo(capaPlan);
    plan.rutas.forEach(function (r, i) {
      if (i === plan.elegida) return;
      L.polyline(r.coords, { color: '#7d8a92', weight: 5, opacity: .7 }).on('click', function () { plan.elegida = i; pintarAlternativas(); pintarPlan(); }).addTo(capaPlan);
    });
    if (plan.elegida >= 0) {
      const r = plan.rutas[plan.elegida];
      L.polyline(r.coords, { color: '#B6F567', weight: 7 }).addTo(capaPlan);
      mapaPlan.fitBounds(L.latLngBounds(r.coords), { padding: [30, 30] });
    } else if (plan.destino) {
      mapaPlan.fitBounds(L.latLngBounds([plan.origen, plan.destino.coords]), { padding: [40, 40] });
    } else {
      mapaPlan.setView(plan.origen, 15);
    }
  }

  // HU-035 · Iniciar con la alternativa elegida (o explicar qué falta)
  function pintarBotonIniciar() {
    const falta = [];
    if (!plan.destino) falta.push('elige un destino');
    else if (plan.elegida < 0) falta.push('espera o elige una ruta');
    if (plan.modo === 'gps' && plan.rutas[0] && plan.rutas[0].fuente === 'demo') falta.push('la ruta de demostración solo funciona en modo Simulación');
    $('iniciar').disabled = falta.length > 0;
    $('falta-iniciar').textContent = falta.length ? 'Para iniciar: ' + falta.join('; ') + '.' : 'Listo: ' + plan.rutas[plan.elegida].nombre + ' · ' + fDist(plan.rutas[plan.elegida].distancia) + '.';
  }

  let pendienteIniciar = false;
  let permisosRevisados = false;
  $('iniciar').addEventListener('click', function () {
    if ($('iniciar').disabled) return;
    // HU-023: revisar permisos antes de navegar (la primera vez, o si falta la ubicación en modo GPS)
    if (!permisosRevisados || (plan.modo === 'gps' && sistema.ubicacion !== 'concedida')) {
      pendienteIniciar = true;
      location.hash = '#permisos';
      return;
    }
    iniciarRecorrido();
  });
  $('continuar-recorrido').addEventListener('click', function () {
    if (plan.modo === 'gps' && sistema.ubicacion !== 'concedida') {
      pedirUbicacion().then(function () { permisosRevisados = true; pendienteIniciar = false; iniciarRecorrido(); })
        .catch(function () { toast('Sin permiso de ubicación no se puede usar el modo GPS real. Usa Simulación.'); });
      return;
    }
    permisosRevisados = true; pendienteIniciar = false;
    iniciarRecorrido();
  });

  /* =========================================================
     Recorrido: HU-019, 039, 040, 041, 042, 043, 014, 026, 048
     ========================================================= */
  let recorrido = null;
  let mapaNav = null, capaNav = null, marcadorBici = null, lineaNav = null;

  function iniciarMapaNav() {
    if (typeof L === 'undefined') return;
    if (!mapaNav) { mapaNav = crearMapa('mapa-nav'); capaNav = L.layerGroup().addTo(mapaNav); }
    setTimeout(function () {
      mapaNav.invalidateSize();
      if (recorrido) {
        capaNav.clearLayers();
        lineaNav = L.polyline(recorrido.ruta.coords, { color: '#B6F567', weight: 7 }).addTo(capaNav);
        L.marker(recorrido.ruta.coords[recorrido.ruta.coords.length - 1], { icon: icono('marcador-punto marcador-punto--destino'), keyboard: false }).addTo(capaNav);
        marcadorBici = L.marker(recorrido.pos, { icon: icono('marcador-bici'), keyboard: false, title: 'Tu posición' }).addTo(capaNav);
        mapaNav.setView(recorrido.pos, 17);
      }
    }, 50);
  }

  function iniciarRecorrido() {
    const ruta = plan.rutas[plan.elegida];
    recorrido = {
      ruta: ruta,
      modo: plan.modo,
      s: 0,
      pos: ruta.coords[0].slice(),
      siguiente: 0,              // índice de la próxima maniobra
      preavisada: {},
      pausado: false,
      desviado: false,
      sinSenal: false,
      llegado: false,
      inicio: Date.now(),
      tiempoActivo: 0,
      ultimoTick: Date.now(),
      velocidad: 1,
      senales: 0,
      desvioOffset: 0,
      reloj: null,
      watchId: null,
      ultimoFix: 0
    };
    $('registro').innerHTML = '';
    $('nav-destino').textContent = ruta.destino;
    $('nav-modo').textContent = plan.modo === 'simulacion' ? 'Simulación' : 'GPS real';
    $('bloque-velocidad').hidden = plan.modo !== 'simulacion';
    $('simular-desvio').hidden = plan.modo !== 'simulacion';
    $('recalcular').hidden = true;
    $('aviso-nav').innerHTML = '';
    $('pausar').textContent = 'Pausar';
    seleccionarEn(null, 'data-vel', '1');
    sistema.ubicacion = plan.modo === 'simulacion' ? 'simulada' : 'concedida';
    actualizarEstado();
    location.hash = '#navegacion';
    registrar('Inicio', 'Recorrido iniciado hacia ' + ruta.destino);
    if (plan.modo === 'simulacion') recorrido.reloj = setInterval(pasoSimulacion, PASO_SIM_MS);
    else iniciarGPS();
    actualizarNav();
  }

  function registrar(titulo, texto) {
    const li = document.createElement('li');
    const hora = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    li.innerHTML = '<strong>' + esc(titulo) + '</strong> · ' + esc(texto) + ' <span>(' + hora + ')</span>';
    $('registro').prepend(li);
  }

  function senal(tipo, texto) {
    const r = S.reproducir(tipo);
    if (recorrido) recorrido.senales++;
    registrar(S.PATRONES[tipo].nombre, texto + (r.vibro ? '' : ' · solo en pantalla'));
    destello();
  }
  function destello() {
    const m = $('maniobra');
    m.animate && m.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 300 });
  }

  // Avance de la simulación
  function pasoSimulacion() {
    if (!recorrido || recorrido.pausado || recorrido.sinSenal || recorrido.desviado || recorrido.llegado) { tiempo(); return; }
    tiempo();
    recorrido.s = Math.min(recorrido.ruta.total, recorrido.s + VELOCIDAD_SIM * recorrido.velocidad * PASO_SIM_MS / 1000);
    recorrido.pos = puntoEn(recorrido.ruta, recorrido.s);
    evaluar();
  }
  function tiempo() {
    if (!recorrido) return;
    const ahora = Date.now();
    if (!recorrido.pausado && !recorrido.llegado) recorrido.tiempoActivo += (ahora - recorrido.ultimoTick) / 1000 * (recorrido.modo === 'simulacion' ? recorrido.velocidad : 1);
    recorrido.ultimoTick = ahora;
  }

  // Modo GPS real
  function iniciarGPS() {
    if (!('geolocation' in navigator)) { perderSenal('Este navegador no ofrece ubicación'); return; }
    recorrido.ultimoFix = Date.now();
    recorrido.watchId = navigator.geolocation.watchPosition(function (pos) {
      if (!recorrido) return;
      recorrido.ultimoFix = Date.now();
      if (recorrido.sinSenal) recuperarSenal();
      tiempo();
      if (recorrido.pausado || recorrido.llegado) return;
      const p = [pos.coords.latitude, pos.coords.longitude];
      recorrido.pos = p;
      const proy = proyectar(p, recorrido.ruta);
      // HU-041: solo se afirma un desvío con una posición válida y precisa
      if (proy.desvio > DESVIO_M && pos.coords.accuracy < DESVIO_M) {
        if (!recorrido.desviado) marcarDesvio();
      } else {
        if (recorrido.desviado) volverARuta();
        if (proy.s > recorrido.s) recorrido.s = proy.s;
      }
      evaluar();
    }, function (err) {
      if (!recorrido) return;
      if (err.code === 1) { sistema.ubicacion = 'denegada'; actualizarEstado(); }
      perderSenal(err.code === 1 ? 'Se retiró el permiso de ubicación' : 'No llega la señal GPS');
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
    // Si no llegan posiciones en 20 s, se considera señal perdida
    recorrido.reloj = setInterval(function () {
      tiempo();
      if (recorrido && !recorrido.pausado && !recorrido.llegado && recorrido.ultimoFix && Date.now() - recorrido.ultimoFix > 20000 && !recorrido.sinSenal) perderSenal('No llegan posiciones del GPS');
    }, 2000);
  }

  // Revisa preavisos, maniobras y llegada según la distancia recorrida
  function evaluar() {
    const r = recorrido, ruta = r.ruta;
    while (r.siguiente < ruta.maniobras.length) {
      const m = ruta.maniobras[r.siguiente];
      const falta = m.s - r.s;
      if (m.tipo === 'llegada') {
        if (falta <= LLEGADA_M) llegar();
        break;
      }
      // HU-040 · Preaviso (no se usa para «recto»)
      if (m.tipo !== 'recto' && falta <= PREAVISO_M && falta > MANIOBRA_M && !r.preavisada[r.siguiente]) {
        r.preavisada[r.siguiente] = true;
        senal('preaviso', 'En ' + fDist(falta) + ': ' + m.texto.toLowerCase());
      }
      // HU-039 · Maniobra
      if (falta <= MANIOBRA_M) {
        senal(m.tipo, m.texto);
        r.siguiente++;
        continue;
      }
      break;
    }
    actualizarNav();
  }

  // HU-019 · Próxima maniobra y distancia
  function actualizarNav() {
    if (!recorrido) return;
    const r = recorrido, ruta = r.ruta;
    const m = ruta.maniobras[Math.min(r.siguiente, ruta.maniobras.length - 1)];
    const falta = Math.max(0, m.s - r.s);
    const flecha = S.PATRONES[m.tipo].flecha;
    const card = $('maniobra');
    card.classList.remove('maniobra--alerta', 'maniobra--error');
    if (r.sinSenal) {
      card.classList.add('maniobra--error');
      $('maniobra-flecha').textContent = '!';
      $('maniobra-dist').textContent = 'Sin señal';
      $('maniobra-texto').textContent = 'Última indicación: ' + m.texto;
    } else if (r.desviado) {
      card.classList.add('maniobra--alerta');
      $('maniobra-flecha').textContent = '⤺';
      $('maniobra-dist').textContent = 'Fuera de ruta';
      $('maniobra-texto').textContent = 'Vuelve a la ruta o recalcula';
    } else if (r.llegado) {
      $('maniobra-flecha').textContent = '◎';
      $('maniobra-dist').textContent = 'Llegaste';
      $('maniobra-texto').textContent = ruta.destino;
    } else {
      $('maniobra-flecha').textContent = flecha;
      $('maniobra-dist').textContent = fDist(falta);
      $('maniobra-texto').textContent = m.texto + (r.pausado ? ' · en pausa' : '');
    }
    $('nav-restante').textContent = fDist(Math.max(0, ruta.total - r.s));
    $('nav-progreso').style.width = Math.min(100, r.s / ruta.total * 100) + '%';
    if (marcadorBici) {
      marcadorBici.setLatLng(r.pos);
      if (mapaNav && !$('vista-navegacion').hidden) mapaNav.panTo(r.pos, { animate: false });
    }
    // Capa del modo sin mirar
    $('sm-flecha').textContent = $('maniobra-flecha').textContent;
    $('sm-dist').textContent = $('maniobra-dist').textContent;
    $('sm-texto').textContent = $('maniobra-texto').textContent;
    $('capa-sin-mirar').classList.toggle('alerta', r.desviado || r.sinSenal);
  }

  // HU-043 · Pausar y reanudar
  $('pausar').addEventListener('click', function () {
    if (!recorrido || recorrido.llegado) return;
    tiempo();
    recorrido.pausado = !recorrido.pausado;
    this.textContent = recorrido.pausado ? 'Reanudar' : 'Pausar';
    registrar(recorrido.pausado ? 'Pausa' : 'Reanudado', recorrido.pausado ? 'Recorrido en pausa; se mantiene el tramo actual' : 'Continúas desde el mismo tramo');
    if (recorrido.pausado) S.detener();
    actualizarNav();
  });

  // HU-014 · Aviso de vehículo cercano (simulado)
  let tVehiculo;
  document.querySelectorAll('[data-vehiculo]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!recorrido) return;
      const lado = b.dataset.vehiculo;
      senal('vehiculo', 'Vehículo cercano por la ' + lado + ' (simulado)');
      $('aviso-nav').innerHTML = '<div class="aviso aviso--ambar" role="alert"><strong>⚠ Vehículo cercano por la ' + lado + '.</strong> Mantén tu carril y reduce la velocidad.</div>';
      if (!$('capa-sin-mirar').hidden) { $('sm-texto').textContent = 'Vehículo cercano por la ' + lado; $('capa-sin-mirar').classList.add('alerta'); }
      clearTimeout(tVehiculo);
      tVehiculo = setTimeout(function () { if (!recorrido || (!recorrido.desviado && !recorrido.sinSenal)) $('aviso-nav').innerHTML = ''; actualizarNav(); }, 4000);
    });
  });

  // HU-041 · Desvío y recalcular
  function marcarDesvio() {
    recorrido.desviado = true;
    $('recalcular').hidden = false;
    $('aviso-nav').innerHTML = '<div class="aviso aviso--ambar" role="alert"><strong>Te saliste de la ruta.</strong> Estás a más de ' + DESVIO_M + ' m del camino. Regresa o toca «Recalcular».</div>';
    senal('desvio', 'Estás a más de ' + DESVIO_M + ' m de la ruta');
    actualizarNav();
  }
  function volverARuta() {
    recorrido.desviado = false;
    $('recalcular').hidden = true;
    $('aviso-nav').innerHTML = '';
    registrar('Ruta', 'De vuelta en la ruta');
  }
  $('simular-desvio').addEventListener('click', function () {
    if (!recorrido || recorrido.llegado) return;
    if (recorrido.desviado) { toast('Ya estás fuera de la ruta: toca «Recalcular»'); return; }
    // Se mueve la posición simulada hacia un costado de la calle (perpendicular a la dirección de la ruta).
    // La posición sí existe, por eso se puede afirmar el desvío (HU-041).
    const r = recorrido.ruta;
    const a = puntoEn(r, Math.max(0, recorrido.s - 5)), b = puntoEn(r, Math.min(r.total, recorrido.s + 5));
    const k = Math.cos(a[0] * Math.PI / 180) * 111320, m = 110540;
    let este = (b[1] - a[1]) * k, norte = (b[0] - a[0]) * m;
    const largo = Math.hypot(este, norte) || 1;
    este /= largo; norte /= largo;
    const base = puntoEn(r, recorrido.s);
    // Se prueba a la derecha y a la izquierda, cada vez más lejos, hasta quedar fuera de la ruta
    for (const metros of [60, 90, 130]) {
      for (const lado of [1, -1]) {
        const p = desplazar(base, -este * metros * lado, norte * metros * lado);
        if (proyectar(p, r).desvio > DESVIO_M) {
          recorrido.pos = p;
          marcarDesvio();
          return;
        }
      }
    }
    toast('No se pudo simular el desvío en este punto. Inténtalo unos metros más adelante.');
  });
  $('recalcular').addEventListener('click', function () {
    if (!recorrido) return;
    const r = recorrido;
    if (r.ruta.fuente === 'osrm' && navigator.onLine) {
      $('aviso-nav').innerHTML = '<div class="aviso">Recalculando desde tu posición…</div>';
      const d = r.ruta.coords[r.ruta.coords.length - 1];
      pedirJSON(URL_RUTA + r.pos[1] + ',' + r.pos[0] + ';' + d[1] + ',' + d[0] + '?overview=full&geometries=geojson&steps=true', 15000).then(function (res) {
        if (res.code !== 'Ok' || !res.routes.length) throw new Error(res.code);
        const nueva = rutaDesdeOSRM(res.routes[0], 0, r.ruta.destino);
        nueva.nombre = 'Ruta recalculada';
        r.ruta = nueva; r.s = 0; r.siguiente = 0; r.preavisada = {};
        volverARuta(); iniciarMapaNav();
        registrar('Ruta', 'Ruta recalculada desde tu posición');
        evaluar();
      }).catch(function () {
        $('aviso-nav').innerHTML = '<div class="aviso aviso--rojo" role="alert"><strong>No se pudo recalcular.</strong> Regresa a la ruta marcada en el mapa o vuelve a intentarlo.</div>';
      });
    } else {
      // Ruta de demostración o sin internet: se vuelve al punto más cercano de la ruta original
      r.pos = puntoEn(r.ruta, r.s);
      recorrido.desviado = false;
      $('recalcular').hidden = true;
      $('aviso-nav').innerHTML = '';
      registrar('Ruta', r.ruta.fuente === 'demo' ? 'Simulación: regresas a la ruta original' : 'Sin internet: sigue la ruta original');
      evaluar();
    }
  });

  // HU-048 · Pérdida de ubicación o conexión
  function perderSenal(motivo) {
    if (!recorrido || recorrido.sinSenal) return;
    recorrido.sinSenal = true;
    if (sistema.ubicacion !== 'denegada') sistema.ubicacion = 'sinsenal';
    actualizarEstado();
    senal('perdida', motivo);
    $('aviso-nav').innerHTML = '<div class="aviso aviso--rojo" role="alert"><strong>Se perdió la señal de ubicación.</strong> ' + esc(motivo) +
      '. Detente en un lugar seguro. La guía se reanudará sola cuando vuelva la señal.' +
      (recorrido.modo === 'simulacion' ? ' <button class="btn btn--secundario btn--sm" id="restablecer-senal" type="button">Restablecer señal (simulación)</button>' : '') + '</div>';
    const b = $('restablecer-senal');
    if (b) b.addEventListener('click', recuperarSenal);
    actualizarNav();
  }
  function recuperarSenal() {
    if (!recorrido || !recorrido.sinSenal) return;
    recorrido.sinSenal = false;
    sistema.ubicacion = recorrido.modo === 'simulacion' ? 'simulada' : 'concedida';
    actualizarEstado();
    $('aviso-nav').innerHTML = '';
    registrar('Señal', 'Señal recuperada, continúa la guía');
    toast('Señal recuperada');
    actualizarNav();
  }
  $('simular-perdida').addEventListener('click', function () {
    if (!recorrido || recorrido.llegado) return;
    if (recorrido.sinSenal) recuperarSenal(); else perderSenal('Simulación de pérdida de señal');
  });
  function alPerderConexion() {
    if (!recorrido || recorrido.llegado) return;
    senal('perdida', 'Sin conexión a internet');
    toast('Sin conexión: la ruta ya cargada sigue funcionando, pero el mapa puede no actualizarse');
  }
  function alRecuperarConexion() { if (recorrido) { registrar('Conexión', 'Conexión recuperada'); toast('Conexión recuperada'); } }

  // HU-026 · Modo sin mirar (pantalla negra, grande y encendida)
  let wakeLock = null;
  $('sin-mirar').addEventListener('click', function () {
    $('capa-sin-mirar').hidden = false;
    actualizarNav();
    $('salir-sin-mirar').focus();
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(function (wl) {
        wakeLock = wl;
        $('sm-pantalla').textContent = 'La pantalla se mantendrá encendida.';
      }).catch(function () { $('sm-pantalla').textContent = 'No se pudo mantener la pantalla encendida: desactiva el bloqueo automático.'; });
    } else {
      $('sm-pantalla').textContent = 'Este navegador no puede mantener la pantalla encendida: desactiva el bloqueo automático.';
    }
    S.reproducir('recto');
    registrar('Modo sin mirar', 'Activado');
  });
  function salirSinMirar() {
    $('capa-sin-mirar').hidden = true;
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    $('sin-mirar').focus();
  }
  $('salir-sin-mirar').addEventListener('click', salirSinMirar);
  document.addEventListener('visibilitychange', function () {
    // El wake lock se libera al salir de la pestaña: se vuelve a pedir al regresar
    if (document.visibilityState === 'visible' && !$('capa-sin-mirar').hidden && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(function (wl) { wakeLock = wl; }).catch(function () {});
    }
  });

  // HU-042 · Llegada
  function llegar() {
    const r = recorrido;
    if (r.llegado) return;
    r.s = r.ruta.total;
    r.pos = puntoEn(r.ruta, r.s);
    tiempo();
    r.llegado = true;
    senal('llegada', 'Llegaste a ' + r.ruta.destino);
    actualizarNav();
    guardarEnHistorial('Completado');
    if (!$('capa-sin-mirar').hidden) salirSinMirar();
    dialogo('¡Llegaste a tu destino!', r.ruta.destino + ' · ' + fDist(r.ruta.total) + ' en ' + fTiempo(r.tiempoActivo) + '. El recorrido se guardó en tu historial.', [
      { texto: 'Ver historial', clase: 'btn--secundario', accion: function () { terminarRecorrido(); location.hash = '#historial'; } },
      { texto: 'Volver al panel', clase: 'btn--primario', accion: function () { terminarRecorrido(); location.hash = '#panel'; } }
    ], false);
  }

  // HU-022 · Finalizar con confirmación
  $('finalizar').addEventListener('click', function () {
    if (!recorrido || recorrido.llegado) return;
    dialogo('¿Finalizar el recorrido?', 'Aún no llegas a tu destino. Se guardará en tu historial con la distancia recorrida hasta ahora.', [
      { texto: 'Continuar recorrido', clase: 'btn--secundario' },
      { texto: 'Finalizar y guardar', clase: 'btn--primario', accion: function () {
        tiempo();
        guardarEnHistorial('Finalizado antes de llegar');
        terminarRecorrido();
        toast('Recorrido guardado en tu historial');
        location.hash = '#historial';
      } }
    ]);
  });

  function guardarEnHistorial(estado) {
    const r = recorrido;
    const hist = leer('haptiride-historial', []);
    hist.push({
      fecha: new Date(r.inicio).toISOString(),
      destino: r.ruta.destino,
      distancia: Math.round(r.s),
      duracion: Math.round(r.tiempoActivo),
      senales: r.senales,
      modo: r.modo === 'simulacion' ? 'Simulación' : 'GPS real',
      estado: estado
    });
    guardar('haptiride-historial', hist);
  }

  function terminarRecorrido() {
    if (!recorrido) return;
    clearInterval(recorrido.reloj);
    if (recorrido.watchId !== null) navigator.geolocation.clearWatch(recorrido.watchId);
    S.detener();
    if (!$('capa-sin-mirar').hidden) salirSinMirar();
    recorrido = null;
    sistema.ubicacion = 'desconocida';
    revisarPermisoUbicacion();
  }

  // Velocidad de la simulación
  document.querySelectorAll('[data-vel]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!recorrido) return;
      tiempo();
      recorrido.velocidad = Number(b.dataset.vel);
      seleccionarEn(null, 'data-vel', b.dataset.vel);
    });
  });

  // Evitar cerrar la pestaña por accidente durante un recorrido
  window.addEventListener('beforeunload', function (e) { if (recorrido && !recorrido.llegado) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Arranque ---------- */
  if (location.protocol === 'file:') {
    const av = document.createElement('div');
    av.className = 'aviso aviso--ambar';
    av.setAttribute('role', 'note');
    av.innerHTML = '<strong>Abriste el archivo directamente.</strong> La búsqueda de destinos y las rutas reales pueden no funcionar así. Ábrelo desde GitHub Pages o con Live Server. La ruta de demostración sí funciona.';
    $('vista-mapa').querySelector('.contenedor').insertBefore(av, $('vista-mapa').querySelector('.tarjeta'));
  }
  revisarPermisoUbicacion();
  actualizarEstado();
  mostrarVista();

  // Ganchos para pruebas automáticas y para la demostración
  window.HaptiApp = { estado: function () { return recorrido; }, plan: plan, usarDemo: usarDemo };
})();
