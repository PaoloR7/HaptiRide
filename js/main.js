/* =========================================================
   HaptiRide · Landing page
   - Menú responsive (HU-031, HU-032)
   - Probar señales (HU-013)
   - Formulario de soporte (HU-029)
   ========================================================= */
(function () {
  'use strict';
  const S = window.HaptiSenales;

  /* ---------- Menú móvil ---------- */
  const botonMenu = document.getElementById('boton-menu');
  const menu = document.getElementById('menu');
  function cerrarMenu() {
    menu.classList.remove('abierto');
    botonMenu.setAttribute('aria-expanded', 'false');
    botonMenu.setAttribute('aria-label', 'Abrir menú');
  }
  botonMenu.addEventListener('click', function () {
    const abierto = menu.classList.toggle('abierto');
    botonMenu.setAttribute('aria-expanded', String(abierto));
    botonMenu.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
    if (abierto) menu.querySelector('a').focus();
  });
  menu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', cerrarMenu); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && menu.classList.contains('abierto')) { cerrarMenu(); botonMenu.focus(); }
  });

  /* ---------- HU-013: Probar señales ---------- */
  const aviso = document.getElementById('aviso-vibracion');
  const estado = document.getElementById('estado-senal');
  const manubrio = document.getElementById('manubrio-prueba');
  const config = S.leerConfig();

  if (!S.puedeVibrar) {
    aviso.className = 'aviso aviso--ambar';
    aviso.textContent = 'Este navegador no permite vibrar (por ejemplo, iPhone o computadora). Verás la señal en el manubrio de la ilustración. Para sentirla, abre esta página en Chrome para Android.';
  } else if (!config.activas) {
    aviso.className = 'aviso aviso--ambar';
    aviso.innerHTML = 'Las señales de vibración están desactivadas en tu configuración. <a href="app.html#configuracion">Actívalas aquí</a>.';
  } else {
    aviso.textContent = 'Toca una señal: tu celular debería vibrar. Si no sientes nada, revisa que la vibración del celular esté activada.';
  }

  // ¿Sentiste la vibración? El navegador no sabe si el celular tiene la vibración apagada
  const confirmar = document.getElementById('confirmar-vibracion');
  const confirmada = S.leerConfirmacion();
  if (S.puedeVibrar && config.activas && confirmada) S.preguntarVibracion(confirmar, { estado: confirmada });

  const botones = document.querySelectorAll('[data-patron]');
  botones.forEach(function (boton) {
    boton.addEventListener('click', function () {
      const tipo = boton.dataset.patron;
      const p = S.PATRONES[tipo];
      botones.forEach(function (b) { b.setAttribute('aria-pressed', String(b === boton)); });
      const r = S.reproducir(tipo, {
        alPulsar: S.animarManubrio(manubrio, tipo),
        alTerminar: function () { boton.setAttribute('aria-pressed', 'false'); }
      });
      estado.textContent = p.nombre + ': ' + p.descripcion + (r.vibro ? ' (vibrando)' : ' (solo visual)');
      // Mientras no confirme que la siente, se pregunta después de cada prueba
      if (r.vibro && S.leerConfirmacion() !== 'si') {
        S.preguntarVibracion(confirmar, { tipo: tipo, reproducir: { alPulsar: S.animarManubrio(manubrio, tipo) } });
      }
    });
  });

  /* Animación de ejemplo en el hero: alterna izquierda y derecha */
  const manubrioHero = document.getElementById('manubrio-hero');
  const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (manubrioHero && !reducir) {
    let turno = 0;
    function demoHero() {
      const tipo = turno++ % 2 === 0 ? 'izquierda' : 'derecha';
      const sec = S.secuencia(tipo, S.CONFIG_INICIAL);
      const pintar = S.animarManubrio(manubrioHero, tipo);
      let t = 0;
      sec.forEach(function (ms, i) { setTimeout(function () { pintar(i % 2 === 0); }, t); t += ms; });
      setTimeout(function () { pintar(false); }, t);
    }
    demoHero();
    setInterval(demoHero, 3200);
  }

  /* ---------- HU-029: Soporte ---------- */
  const form = document.getElementById('form-soporte');
  const confirmacion = document.getElementById('confirmacion-soporte');
  const campoContacto = document.getElementById('contacto');
  const etqContacto = document.getElementById('etq-contacto');
  let medio = 'correo';

  document.querySelectorAll('[data-medio]').forEach(function (b) {
    b.addEventListener('click', function () {
      medio = b.dataset.medio;
      document.querySelectorAll('[data-medio]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (medio === 'correo') {
        etqContacto.textContent = 'Correo electrónico';
        campoContacto.type = 'email'; campoContacto.autocomplete = 'email'; campoContacto.inputMode = 'email';
        campoContacto.placeholder = 'nombre@correo.com';
      } else {
        etqContacto.textContent = 'Número de WhatsApp';
        campoContacto.type = 'tel'; campoContacto.autocomplete = 'tel'; campoContacto.inputMode = 'tel';
        campoContacto.placeholder = '9XX XXX XXX';
      }
      campoContacto.value = '';
      limpiarError(campoContacto);
    });
  });
  campoContacto.placeholder = 'nombre@correo.com';

  function mostrarError(campo, texto) {
    campo.setAttribute('aria-invalid', 'true');
    document.getElementById('error-' + campo.id).textContent = texto;
  }
  function limpiarError(campo) {
    campo.removeAttribute('aria-invalid');
    document.getElementById('error-' + campo.id).textContent = '';
  }

  function validar(campo) {
    const v = campo.value.trim();
    if (campo.id === 'asunto' && !v) return 'Elige un asunto.';
    if (campo.id === 'descripcion') {
      if (!v) return 'Describe tu problema o sugerencia.';
      if (v.length < 15) return 'Escribe al menos 15 caracteres (llevas ' + v.length + ').';
    }
    if (campo.id === 'contacto') {
      if (!v) return medio === 'correo' ? 'Escribe tu correo.' : 'Escribe tu número de WhatsApp.';
      if (medio === 'correo' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'El correo no es válido. Ejemplo: nombre@correo.com';
      if (medio === 'whatsapp' && !/^9\d{8}$/.test(v.replace(/[\s-]/g, ''))) return 'El número debe tener 9 dígitos y empezar con 9.';
    }
    return '';
  }

  ['asunto', 'descripcion', 'contacto'].forEach(function (id) {
    const campo = document.getElementById(id);
    campo.addEventListener('blur', function () {
      const e = validar(campo);
      if (e) mostrarError(campo, e); else limpiarError(campo);
    });
    campo.addEventListener('input', function () {
      if (campo.getAttribute('aria-invalid') === 'true' && !validar(campo)) limpiarError(campo);
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    let primero = null;
    ['asunto', 'descripcion', 'contacto'].forEach(function (id) {
      const campo = document.getElementById(id);
      const err = validar(campo);
      if (err) { mostrarError(campo, err); if (!primero) primero = campo; } else limpiarError(campo);
    });
    if (primero) { primero.focus(); return; }

    const codigo = 'HR-' + String(Math.floor(1000 + Math.random() * 9000));
    const solicitud = {
      codigo: codigo,
      fecha: new Date().toISOString(),
      asunto: form.asunto.value,
      descripcion: form.descripcion.value.trim(),
      medio: medio,
      contacto: campoContacto.value.trim()
    };
    try {
      const lista = JSON.parse(localStorage.getItem('haptiride-soporte') || '[]');
      lista.push(solicitud);
      localStorage.setItem('haptiride-soporte', JSON.stringify(lista));
    } catch (err) { /* sin almacenamiento */ }

    document.getElementById('codigo-soporte').textContent = codigo;
    document.getElementById('resumen-soporte').textContent =
      'Asunto: ' + solicitud.asunto + '. Medio de respuesta indicado: ' + (medio === 'correo' ? 'correo, ' : 'WhatsApp, ') + solicitud.contacto + '.';
    form.hidden = true;
    confirmacion.hidden = false;
    confirmacion.focus();
  });

  document.getElementById('nueva-solicitud').addEventListener('click', function () {
    form.reset();
    confirmacion.hidden = true;
    form.hidden = false;
    form.asunto.focus();
  });
})();
