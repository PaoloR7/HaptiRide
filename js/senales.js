/* =========================================================
   HaptiRide · Señales hápticas (compartido por la landing y la app)
   - Patrones de vibración de cada maniobra
   - Configuración guardada en el navegador (HU-044, HU-045, HU-046)
   - Vibration API del navegador: navigator.vibrate()
   ========================================================= */
(function () {
  'use strict';

  const CLAVE_CONFIG = 'haptiride-config';

  // Valores por defecto de la configuración de señales
  const CONFIG_INICIAL = {
    activas: true,          // HU-044: activar o desactivar las señales
    intensidad: 'media',    // HU-046: baja | media | alta
    duracion: 'media',      // HU-045: corta | media | larga
    pulsos: 1,              // HU-045: 1, 2 o 3 repeticiones de cada señal
    intervalo: 'medio'      // HU-045: corto | medio | largo
  };

  // Equivalencias en milisegundos
  const MS_DURACION = { corta: 120, media: 200, larga: 300 };
  const MS_INTERVALO = { corto: 90, medio: 160, largo: 260 };
  // El navegador no controla la fuerza del motor: la intensidad se representa
  // alargando o acortando cada pulso (HU-046 CA03).
  const FACTOR_INTENSIDAD = { baja: 0.7, media: 1, alta: 1.45 };

  // Cada señal se distingue por su ritmo: 'c' = pulso corto, 'L' = pulso largo, 'r' = pulso rápido
  const PATRONES = {
    izquierda: { nombre: 'Girar a la izquierda', ritmo: ['c', 'c'], lado: 'izquierda', flecha: '←', descripcion: '2 pulsos' },
    derecha: { nombre: 'Girar a la derecha', ritmo: ['c', 'c', 'c'], lado: 'derecha', flecha: '→', descripcion: '3 pulsos' },
    recto: { nombre: 'Continuar recto', ritmo: ['L'], lado: 'ambos', flecha: '↑', descripcion: '1 pulso largo' },
    vehiculo: { nombre: 'Aviso de vehículo', ritmo: ['r', 'r', 'r', 'r', 'r'], lado: 'ambos', flecha: '⚠', descripcion: '5 pulsos rápidos', alerta: true, sinRepeticion: true },
    llegada: { nombre: 'Llegada', ritmo: ['L', 'c', 'L'], lado: 'ambos', flecha: '◎', descripcion: 'largo, corto, largo' },
    preaviso: { nombre: 'Preaviso de giro', ritmo: ['c'], lado: 'ambos', flecha: '…', descripcion: '1 pulso corto', sinRepeticion: true },
    perdida: { nombre: 'Aviso de señal perdida', ritmo: ['L', 'L'], lado: 'ambos', flecha: '!', descripcion: '2 pulsos largos', alerta: true, sinRepeticion: true },
    desvio: { nombre: 'Aviso de desvío', ritmo: ['L', 'L', 'L'], lado: 'ambos', flecha: '⤺', descripcion: '3 pulsos largos', alerta: true, sinRepeticion: true }
  };

  function leerConfig() {
    try {
      const guardada = JSON.parse(localStorage.getItem(CLAVE_CONFIG));
      return Object.assign({}, CONFIG_INICIAL, guardada || {});
    } catch (e) {
      return Object.assign({}, CONFIG_INICIAL);
    }
  }

  function guardarConfig(config) {
    try { localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config)); } catch (e) { /* sin almacenamiento */ }
  }

  const puedeVibrar = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  // Convierte un patrón en la secuencia [vibra, pausa, vibra, ...] que usa navigator.vibrate()
  function secuencia(tipo, config) {
    const p = PATRONES[tipo];
    const c = config || leerConfig();
    const pulso = MS_DURACION[c.duracion] * FACTOR_INTENSIDAD[c.intensidad];
    const pausa = MS_INTERVALO[c.intervalo];
    const una = [];
    p.ritmo.forEach(function (t, i) {
      let ms = pulso;
      if (t === 'L') ms = pulso * 2.5;
      if (t === 'r') ms = 70 * FACTOR_INTENSIDAD[c.intensidad];
      una.push(Math.round(ms));
      if (i < p.ritmo.length - 1) una.push(t === 'r' ? 50 : pausa);
    });
    const veces = p.sinRepeticion ? 1 : Number(c.pulsos) || 1;
    const total = [];
    for (let r = 0; r < veces; r++) {
      if (r > 0) total.push(450); // pausa entre repeticiones
      total.push.apply(total, una);
    }
    return total;
  }

  /**
   * Reproduce una señal.
   * - Vibra si el navegador lo permite y las señales están activas.
   * - Llama a alPulsar(encendido) en cada pulso, para animar la interfaz.
   * Devuelve { vibro: boolean, duracion: ms }.
   */
  let temporizadores = [];
  function reproducir(tipo, opciones) {
    const op = opciones || {};
    const config = op.config || leerConfig();
    const sec = secuencia(tipo, config);
    detener();

    let vibro = false;
    if (puedeVibrar && config.activas) {
      try { vibro = navigator.vibrate(sec); } catch (e) { vibro = false; }
    }

    let t = 0;
    sec.forEach(function (ms, i) {
      const encendido = i % 2 === 0;
      temporizadores.push(setTimeout(function () { if (op.alPulsar) op.alPulsar(encendido); }, t));
      t += ms;
    });
    temporizadores.push(setTimeout(function () {
      if (op.alPulsar) op.alPulsar(false);
      if (op.alTerminar) op.alTerminar();
    }, t));
    return { vibro: vibro, duracion: t };
  }

  function detener() {
    temporizadores.forEach(clearTimeout);
    temporizadores = [];
    if (puedeVibrar) { try { navigator.vibrate(0); } catch (e) { /* nada */ } }
  }

  // Anima un manubrio ilustrado: <div class="manubrio"><span class="puno puno--izq"></span>…<span class="puno puno--der"></span></div>
  function animarManubrio(manubrio, tipo, lado) {
    if (!manubrio) return function () {};
    const p = PATRONES[tipo];
    const izq = manubrio.querySelector('.puno--izq');
    const der = manubrio.querySelector('.puno--der');
    const destino = lado || p.lado;
    const clase = p.alerta ? 'es-alerta' : 'es-activo';
    return function (encendido) {
      [izq, der].forEach(function (el) { el.classList.remove('es-activo', 'es-alerta'); });
      if (!encendido) return;
      if (destino === 'izquierda' || destino === 'ambos') izq.classList.add(clase);
      if (destino === 'derecha' || destino === 'ambos') der.classList.add(clase);
    };
  }

  /* ---------------------------------------------------------
     Confirmación de la vibración (HU-013, HU-024)
     El navegador responde que vibró aunque el celular tenga la vibración
     apagada; no hay forma de detectarlo. Por eso se le pregunta al usuario.
     Valores: 'si' (la sintió), 'no' (no la sintió) o null (sin probar).
     --------------------------------------------------------- */
  const CLAVE_CONFIRMACION = 'haptiride-vibracion-confirmada';
  function leerConfirmacion() {
    try { return localStorage.getItem(CLAVE_CONFIRMACION); } catch (e) { return null; }
  }
  function guardarConfirmacion(valor) {
    try {
      if (valor) localStorage.setItem(CLAVE_CONFIRMACION, valor);
      else localStorage.removeItem(CLAVE_CONFIRMACION);
    } catch (e) { /* sin almacenamiento */ }
    window.dispatchEvent(new CustomEvent('haptiride-confirmacion', { detail: valor }));
  }

  // Marca aproximada del celular, para mostrar los pasos correctos
  function marcaCelular() {
    const ua = navigator.userAgent;
    if (/SM-|Samsung/i.test(ua)) return 'samsung';
    if (/Xiaomi|Redmi|POCO|\bMi \d|M2\d{3}|2\d{3}[A-Z0-9]{4,}/i.test(ua)) return 'xiaomi';
    if (/moto|Motorola|Pixel/i.test(ua)) return 'motorola';
    if (/Huawei|HONOR/i.test(ua)) return 'huawei';
    return null;
  }
  const PASOS_MARCA = {
    samsung: ['Samsung', 'Ajustes › Sonidos y vibración › Intensidad de vibración: sube todas las barras (llamadas, notificaciones y respuesta táctil).'],
    xiaomi: ['Xiaomi / Redmi / POCO', 'Ajustes › Sonido y vibración: activa «Vibración» y «Respuesta háptica» y sube la intensidad.'],
    motorola: ['Motorola / Pixel', 'Ajustes › Sonido y vibración › Vibración y háptica: activa «Usar vibración y háptica».'],
    huawei: ['Huawei / Honor', 'Ajustes › Sonidos y vibración: activa la vibración y la respuesta táctil.']
  };
  // Navegadores internos de redes sociales, donde la vibración suele no funcionar
  const NAVEGADOR_INTERNO = /FBAN|FBAV|Instagram|Line\/|TikTok|musical_ly/i.test(navigator.userAgent);

  function htmlPasos() {
    const marca = marcaCelular();
    const lista = marca ? [PASOS_MARCA[marca]] : Object.keys(PASOS_MARCA).map(function (k) { return PASOS_MARCA[k]; });
    let html = '<ol class="pasos-vibracion">';
    if (NAVEGADOR_INTERNO) html += '<li><strong>Abre la página en Chrome:</strong> estás dentro de una red social. Toca ⋮ › «Abrir en Chrome».</li>';
    html += '<li><strong>Activa la vibración del celular.</strong>' + (marca ? '' : ' Según tu marca:') + '<ul>' +
      lista.map(function (p) { return '<li><strong>' + p[0] + ':</strong> ' + p[1] + '</li>'; }).join('') + '</ul></li>';
    html += '<li><strong>Desactiva el ahorro de batería</strong>: en varios celulares apaga la vibración.</li>';
    html += '<li><strong>Quita el modo No molestar</strong> o el silencio total.</li>';
    if (!NAVEGADOR_INTERNO) html += '<li>Si nada funciona, abre la página en <strong>Chrome</strong> (no dentro de WhatsApp, Instagram o Facebook).</li>';
    return html + '</ol>';
  }

  /**
   * Muestra «¿Sentiste la vibración?» dentro de un contenedor.
   * Si responde «No», muestra los pasos según la marca y el botón «Probar de nuevo».
   */
  function preguntarVibracion(contenedor, opciones) {
    if (!contenedor || !puedeVibrar) return;
    const op = opciones || {};
    const tipo = op.tipo || 'derecha';
    function pintar(estado) {
      if (estado === 'preguntar') {
        contenedor.innerHTML = '<div class="pregunta-vib" role="group" aria-label="Confirmar vibración">' +
          '<strong>¿Sentiste la vibración?</strong>' +
          '<div class="pregunta-vib__botones"><button type="button" class="btn btn--primario btn--sm" data-resp="si">Sí, la sentí</button>' +
          '<button type="button" class="btn btn--secundario btn--sm" data-resp="no">No sentí nada</button></div></div>';
      } else if (estado === 'si') {
        contenedor.innerHTML = '<div class="aviso">✓ <strong>La vibración funciona en este celular.</strong> ' +
          '<button type="button" class="enlace-boton" data-resp="no">¿Dejaste de sentirla?</button></div>';
      } else {
        contenedor.innerHTML = '<div class="aviso aviso--rojo"><strong>Tu celular no está vibrando.</strong> ' +
          'La página envía la señal, pero el celular la está bloqueando. Revisa:' + htmlPasos() +
          '<button type="button" class="btn btn--primario btn--sm" data-resp="reintentar">Probar de nuevo</button></div>';
      }
      contenedor.querySelectorAll('[data-resp]').forEach(function (b) {
        b.addEventListener('click', function () {
          const r = b.dataset.resp;
          if (r === 'reintentar') {
            reproducir(tipo, op.reproducir);
            pintar('preguntar');
            contenedor.querySelector('[data-resp="si"]').focus();
            return;
          }
          guardarConfirmacion(r);
          pintar(r);
          if (op.alResponder) op.alResponder(r);
          if (r === 'no') { // el foco pasa a los pasos para que el lector de pantalla los lea
            const aviso = contenedor.querySelector('.aviso');
            aviso.setAttribute('tabindex', '-1');
            aviso.focus();
          }
        });
      });
    }
    pintar(op.estado || 'preguntar');
  }

  window.HaptiSenales = {
    PATRONES: PATRONES,
    CONFIG_INICIAL: CONFIG_INICIAL,
    leerConfig: leerConfig,
    guardarConfig: guardarConfig,
    puedeVibrar: puedeVibrar,
    secuencia: secuencia,
    reproducir: reproducir,
    detener: detener,
    animarManubrio: animarManubrio,
    leerConfirmacion: leerConfirmacion,
    guardarConfirmacion: guardarConfirmacion,
    preguntarVibracion: preguntarVibracion
  };
})();
