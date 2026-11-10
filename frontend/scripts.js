/* =====================================================================
   Doña Burger — frontend con Supabase
   Requiere en cada HTML, ANTES de scripts.js:
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ===================================================================== */

const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';   // Settings > API
const SUPABASE_ANON_KEY = 'TU_ANON_PUBLIC_KEY';     

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const EMAILS_ROL = {
  mostrador: 'mostrador@donaburger.app',
  cocina: 'cocina@donaburger.app',
  admin: 'admin@donaburger.app'
};
const PREFIJO_PIN = 'dona-'; // Supabase exige contraseñas de 6+ caracteres

const DESTINOS_RAPIDOS = ['Para llevar', 'Domicilio', 'Come aquí'];
const SIN_VEGETALES = 'Sin nada de vegetales';
const VEGETALES = ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillos'];

const GRUPOS_CAMBIOS = [
  { titulo: 'Quitar', emo: '🚫', tipos: ['hamburguesa', 'plato'], opciones: ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillos', 'Sin salsas', 'Sin queso', 'Sin sal', SIN_VEGETALES] },
  { titulo: 'Agregar', emo: '➕', tipos: ['hamburguesa', 'plato'], opciones: ['Extra queso', 'Extra carne', 'Extra tocineta', 'Salsas aparte', 'Extra salsas'] },
  { titulo: 'Cómo prepararla', emo: '👩‍🍳', tipos: ['hamburguesa', 'plato'], opciones: ['Partida a la mitad', 'Bien asada', 'Término medio', 'Sin tostar el pan', 'Empacada aparte'] },
  { titulo: 'Cómo servirla', emo: '🥤', tipos: ['bebida'], opciones: ['Sin hielo', 'Con hielo', 'Bien fría', 'Sin pitillo'] }
];

let menu = [];
let pedidos = [];      // pedidos abiertos (cocinando / listo) con items_pedido
let historial = [];    // pedidos del día (solo admin)
let destinoElegido = null;
let carrito = [];
let pasoZoom = 0;
let sonidoActivo = true;
let conectado = false;
let filtroEstado = 'todos';
let textoBusqueda = '';
let temporizadorRecarga = null;

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
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data } = await db.from('perfiles').select('rol').eq('user_id', session.user.id).maybeSingle();
  return data ? data.rol : null;
}

async function procesarLogin(e) {
  e.preventDefault();
  const rol = $('select-rol').value;
  const pin = $('campo-pin').value.trim();
  const reintentar = `<button class="btn btn-papel" onclick="cerrarDialogo()">Intentar de nuevo</button>`;

  const { error } = await db.auth.signInWithPassword({ email: EMAILS_ROL[rol], password: PREFIJO_PIN + pin });
  if (error) {
    abrirDialogo('Acceso Denegado', 'El PIN ingresado es incorrecto.', reintentar);
    return;
  }
  const rolReal = await obtenerRol();
  if (rolReal !== rol) {
    await db.auth.signOut();
    abrirDialogo('Acceso Denegado', 'Tu usuario no tiene permiso para este rol.', reintentar);
    return;
  }
  window.location.href = rol === 'mostrador' ? 'mostrador.html' : rol === 'cocina' ? 'cocina.html' : 'admin.html';
}

/* ---------------------------------------------------------------
   Carga de datos
   --------------------------------------------------------------- */
async function cargarMenu() {
  const { data, error } = await db.from('menu').select('*').eq('eliminado', false).order('id');
  if (!error) menu = data;
}

async function cargarPedidos() {
  const { data, error } = await db.from('pedidos')
    .select('*, items_pedido(*)')
    .in('estado', ['cocinando', 'listo'])
    .order('creado');
  if (!error) pedidos = data;
}

function inicioDelDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function cargarAdmin() {
  const [est, his] = await Promise.all([
    db.rpc('estadisticas_dia'),
    db.from('pedidos').select('*, items_pedido(*)').gte('creado', inicioDelDia()).order('creado', { ascending: false })
  ]);
  const kpi = document.querySelectorAll('.kpi-valor');
  if (est.data && est.data[0] && kpi.length >= 3) {
    kpi[0].textContent = pesos(est.data[0].ventas);
    kpi[1].textContent = est.data[0].entregados;
    kpi[2].textContent = est.data[0].mas_vendido || '—';
  }
  if (!his.error) historial = his.data;
  pintarHistorial();
}

function programarRecarga() {
  clearTimeout(temporizadorRecarga);
  temporizadorRecarga = setTimeout(recargarTodo, 200);
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
function suscribirTiempoReal() {
  db.channel('donaburger')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, payload => {
      if (payload.eventType === 'INSERT' && $('lista-cocina')) avisarPedidoNuevo();
      programarRecarga();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, programarRecarga)
    .subscribe(estado => {
      conectado = estado === 'SUBSCRIBED';
      pintarConexion();
    });

  // Respaldo por si se cae el websocket
  setInterval(recargarTodo, 15000);
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
  const esRapido = DESTINOS_RAPIDOS.includes(destinoElegido);
  const conNombre = destinoElegido && !esRapido;
  $('rejilla-destinos').innerHTML =
    DESTINOS_RAPIDOS.map(d => `<button class="chip" aria-pressed="${destinoElegido === d}" onclick="elegirDestino('${d}')">${d}</button>`).join('')
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
  else carrito.push({ idProd, nombre: p.nombre, precio: p.precio, cant: 1, notas: [] });
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
  const grupos = GRUPOS_CAMBIOS.map((g, gi) => ({ g, gi })).filter(({ g }) => g.tipos.includes(tipo));

  const html = grupos.map(({ g, gi }) => `
    <p><b>${g.emo} ${g.titulo}</b></p>
    <div class="rejilla">
      ${g.opciones.map((o, oi) => `<button class="chip" aria-pressed="${item.notas.includes(o)}" onclick="alternarNota(${idx},${gi},${oi})">${o}</button>`).join('')}
    </div>`).join('')
    + `<div style="height:.9rem"></div><button class="btn btn-verde btn-xl" onclick="cerrarDialogo();pintarComanda()">Listo</button>`;

  abrirDialogo('Cambios: ' + item.nombre, 'Toca las opciones que pidió el cliente.', html);
}

function alternarNota(idx, gi, oi) {
  const item = carrito[idx];
  const op = GRUPOS_CAMBIOS[gi].opciones[oi];
  if (item.notas.includes(op)) {
    item.notas = item.notas.filter(n => n !== op);
  } else {
    item.notas.push(op);
    // "Sin nada de vegetales" reemplaza a los sin-vegetal individuales y viceversa
    if (op === SIN_VEGETALES) item.notas = item.notas.filter(n => !VEGETALES.includes(n));
    if (VEGETALES.includes(op)) item.notas = item.notas.filter(n => n !== SIN_VEGETALES);
  }
  abrirCambios(idx);
}

function pintarComanda() {
  if (!$('comanda')) return;
  const c = $('comanda');
  if (carrito.length === 0) {
    c.innerHTML = `<p class="vacio">Todavía no has agregado nada.<br>Toca un producto arriba.</p>`;
  } else {
    const total = carrito.reduce((s, i) => s + i.precio * i.cant, 0);
    c.innerHTML = carrito.map((i, idx) => `
      <div class="linea-item">
        <div class="paso-cant">
          <button onclick="cambiarCantidad(${idx},-1)">−</button>
          <span class="n">${i.cant}</span>
          <button onclick="cambiarCantidad(${idx},1)">+</button>
        </div>
        <div class="txt">
          <b>${esc(i.nombre)}</b>
          ${i.notas.length ? `<small>${esc(i.notas.join(', '))}</small>` : ''}
          <button class="btn-fila" onclick="abrirCambios(${idx})">✏️ Cambios</button>
        </div>
      </div>
    `).join('') + `<div class="total"><span>Total</span><span class="cifra">${pesos(total)}</span></div>`;
  }
  const btn = $('btn-enviar');
  if (btn) {
    const cuantos = carrito.reduce((s, i) => s + i.cant, 0);
    btn.disabled = cuantos === 0 || !destinoElegido;
    btn.textContent = !destinoElegido ? 'Primero di para quién es' : (cuantos === 0 ? 'Toca las comidas' : `Enviar a cocina (${cuantos})`);
  }
}

async function enviarACocina() {
  if (!destinoElegido || carrito.length === 0) return;
  const btn = $('btn-enviar');
  btn.disabled = true;

  // El servidor recalcula nombres, precios y total desde el menú
  const items = carrito.map(i => ({ id_prod: i.idProd, cant: i.cant, notas: i.notas }));
  const { error } = await db.rpc('crear_pedido', { p_destino: destinoElegido, p_items: items });

  if (error) {
    abrirDialogo('No se pudo enviar', error.message, `<button class="btn btn-papel" onclick="cerrarDialogo()">Entendido</button>`);
    pintarComanda();
    return;
  }
  carrito = [];
  destinoElegido = null;
  pintarDestinos();
  pintarProductos();
  pintarComanda();
  mostrarAviso('Pedido enviado a cocina', false);
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
  const { error } = await db.rpc('cambiar_estado', { p_id: id, p_estado: estados[accion] });
  if (error) {
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
  const tipos = ['hamburguesa', 'plato', 'bebida'];
  abrirDialogo(p ? 'Cambiar producto' : 'Agregar producto', '',
    `<input id="f-nombre" class="campo" placeholder="Nombre" maxlength="60" value="${esc(p ? p.nombre : '')}">
     <div style="height:.6rem"></div>
     <input id="f-precio" class="campo" type="number" min="0" step="500" placeholder="Precio en COP" value="${p ? p.precio : ''}">
     <div style="height:.6rem"></div>
     <input id="f-emo" class="campo" placeholder="Emoji (ej: 🍔)" maxlength="4" value="${esc(p ? p.emo : '')}">
     <div style="height:.6rem"></div>
     <select id="f-tipo" class="campo">
       ${tipos.map(t => `<option value="${t}" ${p && p.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
     </select>
     <div style="height:.9rem"></div>
     <button class="btn btn-verde btn-xl" onclick="guardarProducto(${id || 'null'})">Guardar</button>
     <button class="btn btn-papel" onclick="cerrarDialogo()">Cancelar</button>`);
  if ($('f-nombre')) $('f-nombre').focus();
}

async function guardarProducto(id) {
  const datos = {
    nombre: $('f-nombre').value.trim(),
    precio: parseInt($('f-precio').value, 10),
    emo: $('f-emo').value.trim() || '🍽️',
    tipo: $('f-tipo').value
  };
  if (!datos.nombre || isNaN(datos.precio) || datos.precio < 0) {
    $('dlg-texto').textContent = 'Escribe un nombre y un precio válido.';
    return;
  }
  const { error } = id
    ? await db.from('menu').update(datos).eq('id', id)
    : await db.from('menu').insert(datos);
  if (error) { $('dlg-texto').textContent = error.message; return; }
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
  const { error } = await db.from('menu').update({ eliminado: true }).eq('id', id); // soft delete
  if (error) {
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
  if ($('form-login')) {
    await db.auth.signOut();
    return;
  }

  const rol = await obtenerRol();
  const requerido = $('panel-nuevo') ? 'mostrador' : $('lista-cocina') ? 'cocina' : $('lista-menu') ? 'admin' : null;
  if (!rol || (rol !== 'admin' && rol !== requerido)) {
    window.location.href = 'login.html';
    return;
  }

  if ($('lista-menu')) iniciarAdmin();
  pintarDestinos();
  await recargarTodo();
  suscribirTiempoReal();
})();