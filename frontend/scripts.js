const MENU_INICIAL = [
  { id: 1, nombre: 'Hamburguesa clásica', precio: 15000, emo: '🍔', tipo: 'hamburguesa' },
  { id: 2, nombre: 'Hamburguesa doble', precio: 22000, emo: '🍔', tipo: 'hamburguesa' },
  { id: 3, nombre: 'Perro caliente', precio: 12000, emo: '🌭', tipo: 'hamburguesa' },
  { id: 4, nombre: 'Salchipapa', precio: 14000, emo: '🍟', tipo: 'plato' },
  { id: 5, nombre: 'Papas francesas', precio: 7000, emo: '🍟', tipo: 'plato' },
  { id: 6, nombre: 'Gaseosa 400 ml', precio: 4000, emo: '🥤', tipo: 'bebida' },
  { id: 7, nombre: 'Jugo natural', precio: 6000, emo: '🧃', tipo: 'bebida' },
  { id: 8, nombre: 'Agua', precio: 3000, emo: '💧', tipo: 'bebida' }
];

const PINS_ACCESO = { mostrador: '1234', cocina: '1234', admin: '9999' };
const DESTINOS_RAPIDOS = ['Para llevar', 'Domicilio', 'Come aquí'];
const SIN_VEGETALES = 'Sin nada de vegetales';
const VEGETALES = ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillos'];

const GRUPOS_CAMBIOS = [
  { titulo: 'Quitar', emo: '🚫', tipos: ['hamburguesa', 'plato'], opciones: ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillos', 'Sin salsas', 'Sin queso', 'Sin sal', SIN_VEGETALES] },
  { titulo: 'Agregar', emo: '➕', tipos: ['hamburguesa', 'plato'], opciones: ['Extra queso', 'Extra carne', 'Extra tocineta', 'Salsas aparte', 'Extra salsas'] },
  { titulo: 'Cómo prepararla', emo: '👩‍🍳', tipos: ['hamburguesa', 'plato'], preparacion: true, opciones: ['Partida a la mitad', 'Bien asada', 'Término medio', 'Sin tostar el pan', 'Empacada aparte'] },
  { titulo: 'Cómo servirla', emo: '🥤', tipos: ['bebida'], preparacion: true, opciones: ['Sin hielo', 'Con hielo', 'Bien fría', 'Sin pitillo'] }
];

const PREPARACION = GRUPOS_CAMBIOS.filter(g => g.preparacion).flatMap(g => g.opciones);
const esPreparacion = n => PREPARACION.includes(n);

let menu = MENU_INICIAL.map(p => ({ ...p }));
let pedidos = [];
let consecutivo = 1;
let destinoElegido = null;
let carrito = [];
let pasoZoom = 0;
let sonidoActivo = true;
let ultimaAccion = null;
let temporizadorAviso = null;
let modoLocal = false;
let idsVistosCocina = new Set();

const CLAVE = 'donaburger:pedidos';
const $ = id => document.getElementById(id);
const pesos = n => '$' + n.toLocaleString('es-CO');

/* Autenticación en Login */
function actualizarPlaceholderPin() {
  const r = $('select-rol').value;
  $('campo-pin').placeholder = r === 'admin' ? 'PIN Admin (9999)' : 'PIN Demo (1234)';
}

function procesarLogin(e) {
  e.preventDefault();
  const rol = $('select-rol').value;
  const pin = $('campo-pin').value.trim();

  if (PINS_ACCESO[rol] && pin === PINS_ACCESO[rol]) {
    if (rol === 'mostrador') window.location.href = 'mostrador.html';
    else if (rol === 'cocina') window.location.href = 'cocina.html';
    else if (rol === 'admin') window.location.href = 'admin.html';
  } else {
    abrirDialogo('Acceso Denegado', 'El PIN ingresado es incorrecto.', `<button class="btn btn-papel" onclick="cerrarDialogo()">Intentar de nuevo</button>`);
  }
}

/* Sincronización */
async function leerRemoto() {
  try {
    const r = await window.storage.get(CLAVE, true);
    modoLocal = false;
    return r ? JSON.parse(r.value) : null;
  } catch (e) { return null; }
}

async function escribirRemoto() {
  try {
    await window.storage.set(CLAVE, JSON.stringify({ menu, pedidos, consecutivo }), true);
    modoLocal = false;
  } catch (e) { modoLocal = true; }
  pintarConexion();
}

function cambiar(fn) {
  fn();
  marcarHora();
  pintarTiquetes();
  guardarEnSegundoPlano();
}

function marcarHora() {
  const ahora = Date.now();
  pedidos.forEach(p => { if (!p.actualizado) p.actualizado = ahora; });
  menu.forEach(c => { if (!c.actualizado) c.actualizado = ahora; });
}

let guardando = false, pendiente = false;
async function guardarEnSegundoPlano() {
  if (guardando) { pendiente = true; return; }
  guardando = true;
  const remoto = await leerRemoto();
  if (remoto) fusionar(remoto);
  await escribirRemoto();
  guardando = false;
  if (pendiente) { pendiente = false; guardarEnSegundoPlano(); }
}

function fusionar(r) {
  pedidos = unir(pedidos, r.pedidos || []);
  menu = unir(menu, r.menu || []);
  consecutivo = Math.max(consecutivo, r.consecutivo || 1);
  const limite = Date.now() - 14 * 60 * 60 * 1000;
  pedidos = pedidos.filter(p => ABIERTOS.includes(p.estado) || p.actualizado > limite);
}

function unir(mios, otros) {
  const mapa = new Map();
  mios.forEach(x => mapa.set(x.id, x));
  otros.forEach(x => {
    const mio = mapa.get(x.id);
    if (!mio || (x.actualizado || 0) > (mio.actualizado || 0)) mapa.set(x.id, x);
  });
  return [...mapa.values()].sort((a, b) => a.id - b.id);
}

async function sincronizar() {
  const remoto = await leerRemoto();
  if (!remoto) { pintarConexion(); return; }
  const antes = JSON.stringify([pedidos, menu]);
  fusionar(remoto);
  if (JSON.stringify([pedidos, menu]) === antes) return;
  if ($('lista-cocina')) avisarPedidoNuevo();
  pintarTiquetes();
  if ($('rejilla-productos')) pintarProductos();
}

setInterval(() => { sincronizar(); }, 2500);

function pintarConexion() {
  const txt = modoLocal ? '⚠️ Almacenamiento local' : '✅ Sincronizado';
  ['sync-mostrador', 'sync-cocina', 'sync-admin'].forEach(id => { if ($(id))$(id).textContent = txt; });
}

/* Zoom */
function cambiarZoom(dir) {
  pasoZoom = Math.max(-1, Math.min(2, pasoZoom + dir));
  const escalas = { '-1': '90%', '0': '100%', '1': '115%', '2': '130%' };
  document.documentElement.style.setProperty('--escala', escalas[pasoZoom]);
}

/* Mostrador */
function verPestana(cual) {
  const esNuevo = cual === 'nuevo';
  $('panel-nuevo').classList.toggle('oculto', !esNuevo);$('panel-curso').classList.toggle('oculto', esNuevo);
  $('tab-nuevo').setAttribute('aria-selected', esNuevo);$('tab-curso').setAttribute('aria-selected', !esNuevo);
  window.scrollTo(0, 0);
}

function pintarDestinos() {
  if (!$('rejilla-destinos')) return;
  const esRapido = DESTINOS_RAPIDOS.includes(destinoElegido);
  const conNombre = destinoElegido && !esRapido;
  $('rejilla-destinos').innerHTML =
    DESTINOS_RAPIDOS.map(d => `<button class="chip" aria-pressed="${destinoElegido === d}" onclick="elegirDestino('${d}')">${d}</button>`).join('')
    + `<button class="chip chip-ancho" aria-pressed="${conNombre}" onclick="pedirNombre()">${conNombre ? '👤 ' + destinoElegido : '✏️ A nombre de…'}</button>`;
}

function pedirNombre() {
  abrirDialogo('¿A nombre de quién?', 'Como lo llamarán al entregar el pedido.',
    `<input type="text" id="campo-cliente" class="campo" placeholder="Ej: Doña Marta" autocomplete="off">
     <div style="height:.9rem"></div>
     <button class="btn btn-verde btn-xl" onclick="guardarNombre()">Listo</button>
     <button class="btn btn-papel" onclick="cerrarDialogo()">Volver</button>`);
  const campo = $('campo-cliente');
  if (campo) { campo.focus(); campo.addEventListener('keydown', e => { if (e.key === 'Enter') guardarNombre(); }); }
}

function guardarNombre() {
  const v = ($('campo-cliente').value || '').trim();
  cerrarDialogo();
  if (!v) return;
  destinoElegido = v;
  pintarDestinos(); pintarComanda();
}

function elegirDestino(d) {
  destinoElegido = (destinoElegido === d) ? null : d;
  pintarDestinos(); pintarComanda();
}

function pintarProductos() {
  if (!$('rejilla-productos')) return;
  $('rejilla-productos').innerHTML = menu.filter(c => !c.eliminado).map(p => {
    const enCarrito = carrito.filter(i => i.idProd === p.id).reduce((s, i) => s + i.cant, 0);
    return `
      <button class="producto" onclick="agregar(${p.id})">
        <span class="nom"><span>${p.emo}</span> ${p.nombre}</span>
        <span class="fila">
          <span class="precio">${pesos(p.precio)}</span>
          ${enCarrito ? `<span class="cuenta">${enCarrito}</span>` : `<span class="mas">+ Agregar</span>`}
        </span>
      </button>`;
  }).join('');
}

function agregar(idProd) {
  const p = menu.find(x => x.id === idProd);
  const existente = carrito.find(i => i.idProd === idProd && i.notas.length === 0);
  if (existente) existente.cant++;
  else carrito.push({ idProd, nombre: p.nombre, precio: p.precio, cant: 1, notas: [] });
  pintarProductos(); pintarComanda();
}

function cambiarCantidad(idx, delta) {
  carrito[idx].cant += delta;
  if (carrito[idx].cant <= 0) carrito.splice(idx, 1);
  pintarProductos(); pintarComanda();
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
        <div class="txt"><b>${i.nombre}</b></div>
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

function enviarACocina() {
  if (!destinoElegido || carrito.length === 0) return;
  const copia = JSON.parse(JSON.stringify(carrito));
  const destino = destinoElegido;
  cambiar(() => {
    pedidos.push({
      id: Date.now(),
      turno: consecutivo++,
      destino,
      items: copia,
      total: copia.reduce((s, i) => s + i.precio * i.cant, 0),
      creado: Date.now(),
      actualizado: Date.now(),
      estado: 'cocinando'
    });
  });
  carrito = []; destinoElegido = null;
  pintarDestinos(); pintarProductos(); pintarComanda();
  mostrarAviso('Pedido enviado a cocina', false);
  verPestana('curso');
}

/* Tiquetes y Cocina */
const ABIERTOS = ['cocinando', 'listo'];
const pedidosActivos = () => pedidos.filter(p => ABIERTOS.includes(p.estado));

function tiquete(p, indice, vista) {
  const min = Math.floor((Date.now() - p.creado) / 60000);
  const listo = p.estado === 'listo';
  let cinta = listo ? '✅ Listo' : (indice === 0 ? '👉 Prepara este primero' : 'En espera');
  let clase = listo ? 'cinta-listo' : (indice === 0 ? 'cinta-ahora' : 'cinta-espera');

  const acciones = vista === 'cocina'
    ? (listo ? `<button class="btn btn-papel menor" onclick="ejecutar(${p.id},'devolver')">Volver a preparar</button>`
             : `<button class="btn btn-verde" onclick="ejecutar(${p.id},'listo')">Ya está listo</button>`)
    : (listo ? `<button class="btn btn-verde" onclick="ejecutar(${p.id},'entregar')">Entregado</button>` : '');

  return `
  <article class="tiquete">
    <div class="cinta ${clase}"><span>${cinta}</span><span>${pesos(p.total)}</span></div>
    <div class="cuerpo">
      <div class="quien">
        <div><h3>${p.destino}</h3><p class="espera">${min} min</p></div>
        <div class="turno">${p.turno}</div>
      </div>
      <ul class="items">
        ${p.items.map(i => `<li><span class="cant">${i.cant}</span><span>${i.nombre}</span></li>`).join('')}
      </ul>
    </div>
    <div class="acciones">${acciones}</div>
  </article>`;
}

function pintarTiquetes() {
  const activos = pedidosActivos().sort((a, b) => a.creado - b.creado);
  if ($('lista-mostrador')) {
    const listos = activos.filter(p => p.estado === 'listo');
    $('cuenta-curso').textContent = activos.length;
    $('aviso-listos').textContent = listos.length ? `✅ ${listos.length} pedido(s) listos` : '';
    $('aviso-listos').classList.toggle('visible', listos.length > 0);
    const orden = [...listos, ...activos.filter(p => p.estado !== 'listo')];
    $('lista-mostrador').innerHTML = orden.length ? orden.map(p => tiquete(p, activos.indexOf(p), 'mostrador')).join('') : `<div class="vacio-grande"><b>No hay pedidos</b></div>`;
  }
  if ($('lista-cocina')) {
    const porPreparar = activos.filter(p => p.estado === 'cocinando');
    $('cuenta-cocina').textContent = porPreparar.length;
    const orden = [...porPreparar, ...activos.filter(p => p.estado !== 'cocinando')];
    $('lista-cocina').innerHTML = orden.length ? orden.map(p => tiquete(p, porPreparar.indexOf(p), 'cocina')).join('') : `<div class="vacio-grande"><b>Cocina al día</b></div>`;
  }
}

function ejecutar(id, accion) {
  cambiar(() => {
    const q = pedidos.find(x => x.id === id);
    if (!q) return;
    if (accion === 'listo') q.estado = 'listo';
    if (accion === 'devolver') q.estado = 'cocinando';
    if (accion === 'entregar') q.estado = 'entregado';
    q.actualizado = Date.now();
  });
}

/* Modales y Utilidades */
function abrirDialogo(titulo, texto, html) {
  if (!$('dlg-titulo')) return;
  $('dlg-titulo').textContent = titulo;
  $('dlg-texto').textContent = texto;
  $('dlg-botones').innerHTML = html;
  $('velo').classList.add('abierto');
}
function cerrarDialogo() { $('velo').classList.remove('abierto'); }

function mostrarAviso(t, conDeshacer) {
  if (!$('aviso')) return;
  $('aviso-texto').textContent = t;
  $('aviso').classList.add('visible');
  setTimeout(() => $('aviso').classList.remove('visible'), 4000);
}

function alternarSonido() {
  sonidoActivo = !sonidoActivo;
  $('btn-sonido').textContent = sonidoActivo ? '🔔 Sonido' : '🔕 Silencio';
}

function avisarPedidoNuevo() {
  const banner = $('banner-nuevo');
  if (banner) {
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 5000);
  }
}

/* Inicialización automática al cargar cada página */
(async function () {
  const remoto = await leerRemoto();
  if (remoto) {
    menu = remoto.menu || menu;
    pedidos = remoto.pedidos || [];
    consecutivo = remoto.consecutivo || 1;
  }
  await escribirRemoto();
  pintarDestinos();
  pintarProductos();
  pintarComanda();
  pintarTiquetes();
})();