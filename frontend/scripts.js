const API = 'http://localhost:8080/api';
// El navegador administra la interacción y la vista; el backend valida y calcula los datos del negocio.
const sesion = () => sessionStorage.getItem('rol');
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (sesion()) headers['X-Role'] = sesion();
  const response = await fetch(`${API}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || `Error HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

let menu = [];
let gruposCambios = [];
let destinosRapidos = [];
let tiposMenu = [];
let pedidos = [];      // pedidos abiertos (cocinando / listo) con items_pedido
let historial = [];    // pedidos del día (solo admin)
let destinoElegido = null;
let carrito = [];
let pasoZoom = 0;
let sonidoActivo = true;
let conectado = false;
let filtroEstado = 'todos';
let textoBusqueda = '';
let solicitudCotizacion = 0;
let claveCotizacion = '';

const $ = id => document.getElementById(id);
const pesos = n => '$' + Number(n).toLocaleString('es-CO');

// Evita inyección de HTML con texto escrito por usuarios (nombre de cliente, notas...)
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------
   Autenticación y roles
   --------------------------------------------------------------- */
function actualizarPlaceholderPin() {
  const r = $('select-rol').value;
  $('campo-pin').placeholder = r === 'admin' ? 'PIN Admin (9999)' : 'PIN Demo (1234)';
}

async function obtenerRol() {
  // TODO: [TAREA PARA COMPAÑERO 4] Enviar el token guardado en sessionStorage a un endpoint de validación y devolver el rol solo si sigue vigente; si expira, borrar sesión y redirigir al login.
  return sesion();
}

async function procesarLogin(e) {
  e.preventDefault();
  const rol = $('select-rol').value;
  const pin = $('campo-pin').value.trim();
  const reintentar = `<button class="btn btn-papel" onclick="cerrarDialogo()">Intentar de nuevo</button>`;

  try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ rol, pin }) }); sessionStorage.setItem('rol', rol); }
  catch (error) { abrirDialogo('Acceso Denegado', error.message, reintentar); return; }
  window.location.href = rol === 'mostrador' ? 'mostrador.html' : rol === 'cocina' ? 'cocina.html' : 'admin.html';
}

/* ---------------------------------------------------------------
   Carga de datos
   --------------------------------------------------------------- */
async function cargarMenu() {
  menu = await api('/menu');
  // El backend es la fuente del catálogo de cambios por tipo de producto.
  if (gruposCambios.length === 0) gruposCambios = await api('/menu/cambios');
  if (destinosRapidos.length === 0) destinosRapidos = await api('/pedidos/destinos');
  if (tiposMenu.length === 0) tiposMenu = await api('/menu/tipos');
}

async function cargarPedidos() {
  pedidos = await api('/pedidos?estado=cocinando,listo');
}

async function cargarAdmin() {
  const [his, estadisticas] = await Promise.all([
    api('/pedidos?hoy=true'),
    api('/admin/estadisticas').catch(() => null)
  ]);
  historial = his;
  pintarHistorial();
  pintarEstadisticas(estadisticas);
}

function pintarEstadisticas(e) {
  if (!$('kpi-ventas')) return;
  $('kpi-ventas').textContent = e ? pesos(e.ventas) : '—';
  $('kpi-entregados').textContent = e ? e.entregados : '—';
  $('kpi-mas-vendido').textContent = e ? e.masVendido : '—';
  if ($('kpi-promedio')) $('kpi-promedio').textContent = e ? pesos(e.promedio) : '—';
}

async function recargarTodo() {
  const tareas = [];
  if ($('rejilla-productos') || $('lista-menu')) tareas.push(cargarMenu());
  if ($('lista-mostrador') || $('lista-cocina')) tareas.push(cargarPedidos());
  if ($('lista-menu')) tareas.push(cargarAdmin());
  await Promise.all(tareas);
  if ($('rejilla-productos')) { pintarProductos(); pintarComanda(); }
  if ($('lista-menu')) pintarMenuAdmin();
  pintarTiquetes();
}

/* ---------------------------------------------------------------
   Tiempo real
   --------------------------------------------------------------- */
async function suscribirTiempoReal() {
  conectado = true; pintarConexion();
  let idsPrevios = new Set(pedidos.map(p => p.id));
  // Polling: detecta pedidos nuevos en cocina y cambios de estado en las vistas compartidas.
  setInterval(async () => {
    try {
      const anteriores = idsPrevios;
      await recargarTodo();
      const actuales = new Set(pedidos.map(p => p.id));
      if ($('lista-cocina') && [...actuales].some(id => !anteriores.has(id))) avisarPedidoNuevo();
      idsPrevios = actuales; conectado = true;
    } catch (_) { conectado = false; }
    pintarConexion();
  }, 3500);
  // Refresca los minutos de espera de los tiquetes
  setInterval(pintarTiquetes, 30000);
}

function pintarConexion() {
  const txt = conectado ? '✅ En vivo' : '⚠️ Sin conexión en vivo';
  ['sync-mostrador', 'sync-cocina', 'sync-admin'].forEach(id => { if ($(id)) $(id).textContent = txt; });
}

/* ---------------------------------------------------------------
   Zoom
   --------------------------------------------------------------- */
function cambiarZoom(dir) {
  pasoZoom = Math.max(-1, Math.min(2, pasoZoom + dir));
  const escalas = { '-1': '90%', '0': '100%', '1': '115%', '2': '130%' };
  document.documentElement.style.setProperty('--escala', escalas[pasoZoom]);
}

/* ---------------------------------------------------------------
   Mostrador
   --------------------------------------------------------------- */
function verPestana(cual) {
  const esNuevo = cual === 'nuevo';
  $('panel-nuevo').classList.toggle('oculto', !esNuevo);
  $('panel-curso').classList.toggle('oculto', esNuevo);
  $('tab-nuevo').setAttribute('aria-selected', esNuevo);
  $('tab-curso').setAttribute('aria-selected', !esNuevo);
  window.scrollTo(0, 0);
}

function pintarDestinos() {
  if (!$('rejilla-destinos')) return;
  const esRapido = destinosRapidos.includes(destinoElegido);
  const conNombre = destinoElegido && !esRapido;
  $('rejilla-destinos').innerHTML =
    destinosRapidos.map(d => `<button class="chip" aria-pressed="${destinoElegido === d}" onclick="elegirDestino('${d}')">${d}</button>`).join('')
    + `<button class="chip chip-ancho" aria-pressed="${conNombre}" onclick="pedirNombre()">${conNombre ? '👤 ' + esc(destinoElegido) : '✏️ A nombre de…'}</button>`;
}

function pedirNombre() {
  abrirDialogo('¿A nombre de quién?', 'Como lo llamarán al entregar el pedido.',
    `<input type="text" id="campo-cliente" class="campo" placeholder="Ej: Doña Marta" autocomplete="off" maxlength="40">
     <div style="height:.9rem"></div>
     <button class="btn btn-verde btn-xl" onclick="guardarNombre()">Listo</button>
     <button class="btn btn-papel" onclick="cerrarDialogo()">Volver</button>`);
  const campo = $('campo-cliente');
  if (campo) {
    campo.focus();
    campo.addEventListener('keydown', e => { if (e.key === 'Enter') guardarNombre(); });
  }
}

function guardarNombre() {
  const v = ($('campo-cliente').value || '').trim();
  cerrarDialogo();
  if (!v) return;
  destinoElegido = v;
  pintarDestinos();
  pintarComanda();
}

function elegirDestino(d) {
  destinoElegido = (destinoElegido === d) ? null : d;
  pintarDestinos();
  pintarComanda();
}

function pintarProductos() {
  if (!$('rejilla-productos')) return;
  $('rejilla-productos').innerHTML = menu.map(p => {
    const enCarrito = carrito.filter(i => i.idProd === p.id).reduce((s, i) => s + i.cant, 0);
    return `
      <button class="producto" onclick="agregar(${p.id})">
        <span class="nom"><span>${esc(p.emo)}</span> ${esc(p.nombre)}</span>
        <span class="fila">
          <span class="precio">${pesos(p.precio)}</span>
          ${enCarrito ? `<span class="cuenta">${enCarrito}</span>` : `<span class="mas">+ Agregar</span>`}
        </span>
      </button>`;
  }).join('');
}

function agregar(idProd) {
  const p = menu.find(x => x.id === idProd);
  if (!p) return;
  const existente = carrito.find(i => i.idProd === idProd && i.notas.length === 0);
  if (existente) existente.cant++;
  else carrito.push({ idProd, cant: 1, notas: [] });
  pintarProductos();
  pintarComanda();
}

function cambiarCantidad(idx, delta) {
  carrito[idx].cant += delta;
  if (carrito[idx].cant <= 0) carrito.splice(idx, 1);
  pintarProductos();
  pintarComanda();
}

/* Cambios / notas por producto */
function abrirCambios(idx) {
  const item = carrito[idx];
  const prod = menu.find(p => p.id === item.idProd);
  const tipo = prod ? prod.tipo : 'plato';
  const grupos = gruposCambios.map((g, gi) => ({ g, gi })).filter(({ g }) => g.tipos.includes(tipo));

  const html = grupos.map(({ g, gi }) => `
    <p><b>${g.emo} ${g.titulo}</b></p>
    <div class="rejilla">
      ${g.opciones.map((o, oi) => `<button class="chip" aria-pressed="${item.notas.includes(o)}" onclick="alternarNota(${idx},${gi},${oi})">${o}</button>`).join('')}
    </div>`).join('')
    + `<div style="height:.9rem"></div><button class="btn btn-verde btn-xl" onclick="cerrarDialogo();pintarComanda()">Listo</button>`;

  abrirDialogo('Cambios: ' + (prod ? prod.nombre : 'producto'), 'Toca las opciones que pidió el cliente.', html);
}

async function alternarNota(idx, gi, oi) {
  const item = carrito[idx];
  const op = gruposCambios[gi].opciones[oi];
  if (item.notas.includes(op)) {
    item.notas = item.notas.filter(n => n !== op);
  } else {
    item.notas.push(op);
  }

  // El servicio valida las opciones, elimina repeticiones y resuelve notas incompatibles.
  try {
    const cotizacion = await api('/pedidos/cotizar', {
      method: 'POST',
      body: JSON.stringify({ items: carrito.map(i => ({ id_prod: i.idProd, cant: i.cant, notas: i.notas })) })
    });
    cotizacion.items.forEach((cotizado, i) => { carrito[i].notas = cotizado.notas; });
  } catch (error) {
    abrirDialogo('Cambio no válido', error.message, `<button class="btn btn-papel" onclick="cerrarDialogo()">Entendido</button>`);
    return;
  }
  abrirCambios(idx);
  pintarComanda();
}

function pintarComanda() {
  if (!$('comanda')) return;
  const c = $('comanda');
  if (carrito.length === 0) {
    c.innerHTML = `<p class="vacio">Todavía no has agregado nada.<br>Toca un producto arriba.</p>`;
  } else {
    c.innerHTML = carrito.map((i, idx) => {
      const producto = menu.find(p => p.id === i.idProd);
      return `
      <div class="linea-item">
        <div class="paso-cant">
          <button onclick="cambiarCantidad(${idx},-1)">−</button>
          <span class="n">${i.cant}</span>
          <button onclick="cambiarCantidad(${idx},1)">+</button>
        </div>
        <div class="txt">
          <b>${esc(producto ? producto.nombre : 'Producto')}</b>
          ${i.notas.length ? `<small>${esc(i.notas.join(', '))}</small>` : ''}
          <button class="btn-fila" onclick="abrirCambios(${idx})">✏️ Cambios</button>
        </div>
      </div>
    `;
    }).join('') + `<div class="total"><span>Total</span><span class="cifra" id="total-comanda">Calculando…</span></div>`;
    actualizarTotalComanda();
  }
  const btn = $('btn-enviar');
  if (btn) {
    const cuantos = carrito.reduce((s, i) => s + i.cant, 0);
    btn.disabled = cuantos === 0 || !destinoElegido;
    btn.textContent = !destinoElegido ? 'Primero di para quién es' : (cuantos === 0 ? 'Toca las comidas' : `Enviar a cocina (${cuantos})`);
  }
}

// El total mostrado es una cotización del backend con precios consultados en el menú.
async function actualizarTotalComanda() {
  const total = $('total-comanda');
  if (!total || carrito.length === 0) {
    claveCotizacion = '';
    return;
  }

  const items = carrito.map(i => ({ id_prod: i.idProd, cant: i.cant, notas: i.notas }));
  const preciosActuales = items.map(item => menu.find(p => p.id === item.id_prod)?.precio ?? null);
  const claveActual = JSON.stringify({ items, precios: preciosActuales });
  if (claveActual === claveCotizacion && total.textContent !== 'Calculando…') return;

  claveCotizacion = claveActual;
  const solicitudActual = ++solicitudCotizacion;
  try {
    const cotizacion = await api('/pedidos/cotizar', {
      method: 'POST',
      body: JSON.stringify({ items })
    });
    if (solicitudActual === solicitudCotizacion && $('total-comanda')) {
      $('total-comanda').textContent = pesos(cotizacion.total);
    }
  } catch (error) {
    claveCotizacion = '';
    if (solicitudActual === solicitudCotizacion && $('total-comanda')) {
      $('total-comanda').textContent = 'No disponible';
    }
  }
}

async function enviarACocina() {
  if (!destinoElegido || carrito.length === 0) return;
  const btn = $('btn-enviar');
  btn.disabled = true;

  // El servidor recalcula nombres, precios y total desde el menú
  const items = carrito.map(i => ({ id_prod: i.idProd, cant: i.cant, notas: i.notas }));
  try { await api('/pedidos', { method: 'POST', body: JSON.stringify({ destino: destinoElegido, items }) }); }
  catch (error) {
    abrirDialogo('No se pudo enviar', error.message, `<button class="btn btn-papel" onclick="cerrarDialogo()">Entendido</button>`);
    pintarComanda();
    return;
  }
  carrito = [];
  destinoElegido = null;
  pintarDestinos();
  pintarProductos();
  pintarComanda();
  mostrarAviso('Pedido enviado a cocina');
  await cargarPedidos();
  pintarTiquetes();
  verPestana('curso');
}

/* ---------------------------------------------------------------
   Tiquetes (mostrador y cocina)
   --------------------------------------------------------------- */
function tiquete(p, indice, vista) {
  const min = Math.floor((Date.now() - new Date(p.creado).getTime()) / 60000);
  const listo = p.estado === 'listo';
  const cinta = listo ? '✅ Listo' : (indice === 0 ? '👉 Prepara este primero' : 'En espera');
  const clase = listo ? 'cinta-listo' : (indice === 0 ? 'cinta-ahora' : 'cinta-espera');
  const cancelar = `<button class="btn btn-papel menor" onclick="confirmarCancelar(${p.id})">Cancelar</button>`;

  let acciones;
  if (vista === 'cocina') {
    acciones = listo
      ? `<button class="btn btn-papel menor" onclick="ejecutar(${p.id},'devolver')">Volver a preparar</button>`
      : `<button class="btn btn-verde" onclick="ejecutar(${p.id},'listo')">Ya está listo</button>`;
  } else {
    acciones = (listo ? `<button class="btn btn-verde" onclick="ejecutar(${p.id},'entregar')">Entregado</button>` : '') + cancelar;
  }

  const items = (p.items_pedido || []).map(i => `
    <li><span class="cant">${i.cant}</span>
      <span>${esc(i.nombre)}${i.notas && i.notas.length ? `<br><small>${esc(i.notas.join(', '))}</small>` : ''}</span>
    </li>`).join('');

  return `
  <article class="tiquete">
    <div class="cinta ${clase}"><span>${cinta}</span><span>${pesos(p.total)}</span></div>
    <div class="cuerpo">
      <div class="quien">
        <div><h3>${esc(p.destino)}</h3><p class="espera">${min} min</p></div>
        <div class="turno">${p.turno}</div>
      </div>
      <ul class="items">${items}</ul>
    </div>
    <div class="acciones">${acciones}</div>
  </article>`;
}

function pintarTiquetes() {
  if (!$('lista-mostrador') && !$('lista-cocina')) return;
  const activos = [...pedidos].sort((a, b) => new Date(a.creado) - new Date(b.creado));

  if ($('lista-mostrador')) {
    const listos = activos.filter(p => p.estado === 'listo');
    $('cuenta-curso').textContent = activos.length;
    $('aviso-listos').textContent = listos.length ? `✅ ${listos.length} pedido(s) listos` : '';
    $('aviso-listos').classList.toggle('visible', listos.length > 0);
    const orden = [...listos, ...activos.filter(p => p.estado !== 'listo')];
    $('lista-mostrador').innerHTML = orden.length
      ? orden.map(p => tiquete(p, activos.indexOf(p), 'mostrador')).join('')
      : `<div class="vacio-grande"><b>No hay pedidos</b></div>`;
  }
  if ($('lista-cocina')) {
    const porPreparar = activos.filter(p => p.estado === 'cocinando');
    $('cuenta-cocina').textContent = porPreparar.length;
    const orden = [...porPreparar, ...activos.filter(p => p.estado !== 'cocinando')];
    $('lista-cocina').innerHTML = orden.length
      ? orden.map(p => tiquete(p, porPreparar.indexOf(p), 'cocina')).join('')
      : `<div class="vacio-grande"><b>Cocina al día</b></div>`;
  }
}

async function ejecutar(id, accion) {
  const estados = { listo: 'listo', devolver: 'cocinando', entregar: 'entregado', cancelar: 'cancelado' };
  try { await api(`/pedidos/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: estados[accion] }) }); }
  catch (error) {
    abrirDialogo('No se pudo actualizar', error.message, `<button class="btn btn-papel" onclick="cerrarDialogo()">Entendido</button>`);
  }
  await cargarPedidos();
  pintarTiquetes();
}

function confirmarCancelar(id) {
  abrirDialogo('¿Cancelar este pedido?', 'Esta acción no se puede deshacer.',
    `<button class="btn btn-papel" onclick="cerrarDialogo()">No, volver</button>
     <button class="btn btn-verde" onclick="cerrarDialogo();ejecutar(${id},'cancelar')">Sí, cancelar</button>`);
}

/* ---------------------------------------------------------------
   Administración
   --------------------------------------------------------------- */
function pintarMenuAdmin() {
  if (!$('lista-menu')) return;
  $('lista-menu').innerHTML = menu.map(p => `
    <li class="fila-menu" data-id="${p.id}">
      <span class="fila-menu-emo" aria-hidden="true">${esc(p.emo)}</span>
      <span class="fila-menu-nombre">${esc(p.nombre)}</span>
      <span class="fila-menu-precio">${pesos(p.precio)}</span>
      <div class="fila-menu-acciones">
        <button type="button" class="btn-fila btn-cambiar" data-accion="cambiar" aria-label="Cambiar ${esc(p.nombre)}">✏️ Cambiar</button>
        <button type="button" class="btn-fila btn-quitar" data-accion="quitar" aria-label="Quitar ${esc(p.nombre)}">🗑️ Quitar</button>
      </div>
    </li>`).join('');
}

function dialogoProducto(id) {
  const p = id ? menu.find(x => x.id === id) : null;
  abrirDialogo(p ? 'Cambiar producto' : 'Agregar producto', '',
    `<input id="f-nombre" class="campo" placeholder="Nombre" maxlength="60" value="${esc(p ? p.nombre : '')}">
     <div style="height:.6rem"></div>
     <input id="f-precio" class="campo" type="number" min="0" step="500" placeholder="Precio en COP" value="${p ? p.precio : ''}">
     <div style="height:.6rem"></div>
     <input id="f-emo" class="campo" placeholder="Emoji (ej: 🍔)" maxlength="4" value="${esc(p ? p.emo : '')}">
     <div style="height:.6rem"></div>
     <select id="f-tipo" class="campo">
       ${tiposMenu.map(t => `<option value="${t}" ${p && p.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
     </select>
     <div style="height:.9rem"></div>
     <button class="btn btn-verde btn-xl" onclick="guardarProducto(${id || 'null'})">Guardar</button>
     <button class="btn btn-papel" onclick="cerrarDialogo()">Cancelar</button>`);
  if ($('f-nombre')) $('f-nombre').focus();
}

async function guardarProducto(id) {
  const datos = {
    nombre: $('f-nombre').value,
    precio: parseInt($('f-precio').value, 10),
    emo: $('f-emo').value,
    tipo: $('f-tipo').value
  };

  // El servidor normaliza y valida el producto; aquí solo se recogen los valores del formulario.
  try { await api(id ? `/menu/${id}` : '/menu', { method: id ? 'PUT' : 'POST', body: JSON.stringify(datos) }); }
  catch (error) { $('dlg-texto').textContent = error.message; return; }
  cerrarDialogo();
  await cargarMenu();
  pintarMenuAdmin();
}

function confirmarQuitar(id) {
  const p = menu.find(x => x.id === id);
  if (!p) return;
  abrirDialogo('¿Quitar del menú?', p.nombre + ' dejará de aparecer en el mostrador.',
    `<button class="btn btn-papel" onclick="cerrarDialogo()">Volver</button>
     <button class="btn btn-verde" onclick="quitarProducto(${id})">Sí, quitar</button>`);
}

async function quitarProducto(id) {
  cerrarDialogo();
  try { await api(`/menu/${id}`, { method: 'DELETE' }); } // soft delete
  catch (error) {
    abrirDialogo('No se pudo quitar', error.message, `<button class="btn btn-papel" onclick="cerrarDialogo()">Entendido</button>`);
    return;
  }
  await cargarMenu();
  pintarMenuAdmin();
}

function pintarHistorial() {
  const cuerpo = document.querySelector('.tabla-historial tbody');
  if (!cuerpo) return;
  const grupoDe = p => p.estado === 'entregado' ? 'entregado' : p.estado === 'cancelado' ? 'cancelado' : 'proceso';
  const clases = { entregado: 'entregado', proceso: 'en-proceso', cancelado: 'cancelado' };
  const textos = { entregado: 'Entregado', proceso: 'En Proceso', cancelado: 'Cancelado' };
  const q = textoBusqueda.toLowerCase();

  const filas = historial.filter(p => {
    if (filtroEstado !== 'todos' && grupoDe(p) !== filtroEstado) return false;
    return !q || p.destino.toLowerCase().includes(q) || String(p.turno).includes(q);
  });

  cuerpo.innerHTML = filas.length ? filas.map(p => {
    const g = grupoDe(p);
    const prods = (p.items_pedido || []).map(i => `${i.cant}x ${esc(i.nombre)}`).join(', ');
    return `<tr>
      <td><strong>#${String(p.turno).padStart(3, '0')}</strong></td>
      <td>${esc(p.destino)}</td>
      <td>${prods}</td>
      <td>${pesos(p.total)}</td>
      <td><span class="badge ${clases[g]}">${textos[g]}</span></td>
    </tr>`;
  }).join('') : `<tr><td colspan="5">Sin pedidos para mostrar</td></tr>`;
}

function iniciarAdmin() {
  $('btn-agregar-producto').addEventListener('click', () => dialogoProducto(null));

  $('lista-menu').addEventListener('click', e => {
    const btn = e.target.closest('button[data-accion]');
    if (!btn) return;
    const id = Number(btn.closest('.fila-menu').dataset.id);
    if (btn.dataset.accion === 'cambiar') dialogoProducto(id);
    if (btn.dataset.accion === 'quitar') confirmarQuitar(id);
  });

  const valores = ['todos', 'entregado', 'proceso', 'cancelado'];
  document.querySelectorAll('.btn-filtro').forEach((b, i) => {
    b.addEventListener('click', () => {
      filtroEstado = valores[i];
      document.querySelectorAll('.btn-filtro').forEach(x => x.classList.toggle('active', x === b));
      pintarHistorial();
    });
  });

  const busqueda = document.querySelector('.input-busqueda');
  if (busqueda) busqueda.addEventListener('input', e => { textoBusqueda = e.target.value.trim(); pintarHistorial(); });
  // TODO: [TAREA PARA COMPAÑERO 2] Agregar controles de fecha desde/hasta y un filtro de estado; llamar GET /api/pedidos con parámetros, mantener la búsqueda por cliente/turno y comprobar que cambie la tabla al variar cada filtro.
}

/* ---------------------------------------------------------------
   Modales, avisos y sonido
   --------------------------------------------------------------- */
function abrirDialogo(titulo, texto, html) {
  if (!$('dlg-titulo')) return;
  $('dlg-titulo').textContent = titulo;
  $('dlg-texto').textContent = texto;
  $('dlg-botones').innerHTML = html;
  $('velo').classList.add('abierto');
}
function cerrarDialogo() { $('velo').classList.remove('abierto'); }

function mostrarAviso(t) {
  if (!$('aviso')) return;
  $('aviso-texto').textContent = t;
  $('aviso').classList.add('visible');
  setTimeout(() => $('aviso').classList.remove('visible'), 4000);
}

function alternarSonido() {
  sonidoActivo = !sonidoActivo;
  $('btn-sonido').textContent = sonidoActivo ? '🔔 Sonido' : '🔕 Silencio';
}

function pitido() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) { /* el navegador bloqueó el audio hasta que haya un clic */ }
}

function avisarPedidoNuevo() {
  if (sonidoActivo) pitido();
  const banner = $('banner-nuevo');
  if (banner) {
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 5000);
  }
}

/* ---------------------------------------------------------------
   Inicialización de cada página
   --------------------------------------------------------------- */
(async function iniciar() {
  // En el login siempre se parte sin sesión (los links "Salir" llevan aquí)
  if ($('form-login')) { sessionStorage.removeItem('rol'); return; }

  const rol = await obtenerRol();
  const requerido = $('panel-nuevo') ? 'mostrador' : $('lista-cocina') ? 'cocina' : $('lista-menu') ? 'admin' : null;
  if (!rol || (rol !== 'admin' && rol !== requerido)) {
    window.location.href = 'login.html';
    return;
  }

  await recargarTodo();
  if ($('lista-menu')) iniciarAdmin();
  pintarDestinos();
  suscribirTiempoReal();
})();
