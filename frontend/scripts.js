/* ==========================================================
   1. DATOS INICIALES Y CONFIGURACIÓN
   ========================================================== */
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

// PINS DEMO POR ROL (Modificar o extender según necesidad)
const PINS_ACCESO = {
  mostrador: '1234',
  cocina: '1234',
  admin: '9999'
};

const DESTINOS_RAPIDOS = ['Para llevar', 'Domicilio', 'Come aquí'];
const SIN_VEGETALES = 'Sin nada de vegetales';
const VEGETALES = ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillos'];

const GRUPOS_CAMBIOS = [
  {
    titulo: 'Quitar', emo: '🚫', tipos: ['hamburguesa', 'plato'],
    opciones: ['Sin cebolla', 'Sin tomate', 'Sin lechuga', 'Sin pepinillos', 'Sin salsas', 'Sin queso', 'Sin sal', SIN_VEGETALES]
  },
  {
    titulo: 'Agregar', emo: '➕', tipos: ['hamburguesa', 'plato'],
    opciones: ['Extra queso', 'Extra carne', 'Extra tocineta', 'Salsas aparte', 'Extra salsas']
  },
  {
    titulo: 'Cómo prepararla', emo: '👩‍🍳', tipos: ['hamburguesa', 'plato'], preparacion: true,
    opciones: ['Partida a la mitad', 'Bien asada', 'Término medio', 'Sin tostar el pan', 'Empacada aparte']
  },
  {
    titulo: 'Cómo servirla', emo: '🥤', tipos: ['bebida'], preparacion: true,
    opciones: ['Sin hielo', 'Con hielo', 'Bien fría', 'Sin pitillo']
  }
];

const PREPARACION = GRUPOS_CAMBIOS.filter(g => g.preparacion).flatMap(g => g.opciones);
const esPreparacion = n => PREPARACION.includes(n);

/* ==========================================================
   2. ESTADO GLOBAL
   ========================================================== */
let rol = null;
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

/* ==========================================================
   3. AUTENTICACIÓN Y ROLES
   ========================================================== */
function actualizarPlaceholderPin() {
  const r = $('select-rol').value;
  $('campo-pin').placeholder = r === 'admin' ? 'PIN Admin (9999)' : 'PIN Demo (1234)';
}

function procesarLogin(e) {
  e.preventDefault();
  const rolSeleccionado = $('select-rol').value;
  const pinIngresado = $('campo-pin').value.trim();

  if (PINS_ACCESO[rolSeleccionado] && pinIngresado === PINS_ACCESO[rolSeleccionado]) {
    elegirRol(rolSeleccionado);
    $('campo-pin').value = '';
  } else {
    abrirDialogo(
      'Acceso Denegado',
      'El PIN ingresado es incorrecto.',
      `<button class="btn btn-papel" onclick="cerrarDialogo()">Intentar de nuevo</button>`
    );
  }
}

function cerrarSesion() {
  rol = null;
  mostrarPantalla('login');
}

/* ==========================================================
   4. SINCRONIZACIÓN Y ALMACENAMIENTO
   ========================================================== */
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
  if (rol === 'admin') calcularEstadisticasAdmin();
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
  if (rol === 'cocina') avisarPedidoNuevo();
  pintarTiquetes();
  if (rol === 'mostrador') { pintarProductos(); }
  if (rol === 'admin') { pintarMenuEditableAdmin(); calcularEstadisticasAdmin(); }
}

function aplicarRemoto(r) {
  if (Array.isArray(r.menu) && r.menu.length) menu = r.menu;
  pedidos = r.pedidos || [];
  consecutivo = r.consecutivo || 1;
}
setInterval(() => { if (rol) sincronizar(); }, 2500);

function pintarConexion() {
  const txt = modoLocal
    ? '⚠️ Sin conexión remota — almacenamiento local'
    : '✅ Conectado y sincronizado';
  ['sync-mostrador', 'sync-cocina', 'sync-admin'].forEach(id => { if ($(id))$(id).textContent = txt; });
}

/* ==========================================================
   5. NAVEGACIÓN Y PANTALLAS
   ========================================================== */
function elegirRol(nuevo) {
  rol = nuevo;
  mostrarPantalla(nuevo);
  try {
    if (nuevo === 'cocina') pedidosActivos().forEach(p => idsVistosCocina.add(p.id));
    pintar();
    pintarConexion();
    sincronizar().then(pintar).catch(() => {});
  } catch (e) { console.error(e); }
}

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach(s => s.classList.remove('activa'));
  $(id).classList.add('activa');
  window.scrollTo(0, 0);
}

function verPestana(cual) {
  const esNuevo = cual === 'nuevo';
  $('panel-nuevo').classList.toggle('oculto', !esNuevo);$('panel-curso').classList.toggle('oculto', esNuevo);
  $('tab-nuevo').setAttribute('aria-selected', esNuevo);$('tab-curso').setAttribute('aria-selected', !esNuevo);
  window.scrollTo(0, 0);
}

function cambiarZoom(dir) {
  pasoZoom = Math.max(-1, Math.min(2, pasoZoom + dir));
  const escalas = { '-1': '90%', '0': '100%', '1': '115%', '2': '130%' };
  document.documentElement.style.setProperty('--escala', escalas[pasoZoom]);
  anunciar('Tamaño de letra ajustado');
}

/* ==========================================================
   6. LÓGICA DEL MOSTRADOR / MESERO
   ========================================================== */
function pintarDestinos() {
  const esRapido = DESTINOS_RAPIDOS.includes(destinoElegido);
  const conNombre = destinoElegido && !esRapido;
  $('rejilla-destinos').innerHTML =
    DESTINOS_RAPIDOS.map(d => `
      <button class="chip" aria-pressed="${destinoElegido === d}" onclick="elegirDestino('${d}')">${d}</button>`).join('')
    + `<button class="chip chip-ancho" aria-pressed="${conNombre}" onclick="pedirNombre()">
         ${conNombre ? '👤 ' + destinoElegido : '✏️ A nombre de…'}
       </button>`;
}

function pedirNombre() {
  abrirDialogo('¿A nombre de quién?', 'Como lo llamarán al entregar el pedido.',
    `<input type="text" id="campo-cliente" class="campo" placeholder="Ej: Doña Marta"
            autocomplete="off" value="${DESTINOS_RAPIDOS.includes(destinoElegido) ? '' : (destinoElegido || '')}">
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
  anunciar('Pedido a nombre de ' + v);
}

function elegirDestino(d) {
  destinoElegido = (destinoElegido === d) ? null : d;
  pintarDestinos(); pintarComanda();
  anunciar(destinoElegido ? 'Pedido para ' + d : 'Sin destino');
}

function pintarProductos() {
  $('rejilla-productos').innerHTML = menuActivo().map(p => {
    const enCarrito = carrito.filter(i => i.idProd === p.id).reduce((s, i) => s + i.cant, 0);
    return `
      <button class="producto" onclick="agregar(${p.id})" aria-label="Agregar ${p.nombre}, ${pesos(p.precio)}">
        <span class="nom"><span aria-hidden="true">${p.emo}</span> ${p.nombre}</span>
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
  anunciar(p.nombre + ' agregado');
}

function cambiarCantidad(idx, delta) {
  const item = carrito[idx];
  item.cant += delta;
  if (item.cant <= 0) carrito.splice(idx, 1);
  pintarProductos(); pintarComanda();
}

function pintarComanda() {
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
          <b>${i.nombre}</b>
          ${etiquetasNotas(i.notas)}
        </div>
        <button class="chip" style="min-height:56px;width:auto;padding:.4rem .8rem;font-size:1rem"
                onclick="abrirModificadores(${idx})">
          Cambios${i.notas.length ? ' (' + i.notas.length + ')' : ''}</button>
      </div>
    `).join('') + `
      <div class="total"><span>Total</span><span class="cifra">${pesos(total)}</span></div>`;
  }
  const btn = $('btn-enviar');
  const cuantos = carrito.reduce((s, i) => s + i.cant, 0);
  btn.disabled = cuantos === 0 || !destinoElegido;
  if (!destinoElegido) btn.textContent = 'Primero di para quién es (paso 1)';
  else if (cuantos === 0) btn.textContent = 'Ahora toca las comidas (paso 2)';
  else btn.textContent = `Enviar a la cocina (${cuantos})`;
}

function abrirModificadores(idx) {
  const item = carrito[idx];
  const tipo = (menu.find(p => p.id === item.idProd) || {}).tipo || 'plato';
  const grupos = GRUPOS_CAMBIOS.filter(g => g.tipos.includes(tipo));

  const html = grupos.map(g => `
    <h3 class="grupo-titulo"><span aria-hidden="true">${g.emo}</span> ${g.titulo}</h3>
    <div class="rejilla" style="margin-bottom:1.1rem">
      ${g.opciones.map(o => `
        <button class="chip ${o === SIN_VEGETALES ? 'chip-ancho' : ''} ${g.preparacion ? 'chip-prep' : ''}"
                data-nota="${o}" aria-pressed="${item.notas.includes(o)}"
                onclick="alternarNota(${idx},'${o}')">${o}</button>`).join('')}
    </div>`).join('');

  abrirDialogo('¿Algún cambio?', item.nombre + ' — selecciona las especificaciones:', html + `<button class="btn btn-verde btn-xl" onclick="cerrarDialogo()">Listo</button>`);
}

function alternarNota(idx, nota) {
  const item = carrito[idx];
  const i = item.notas.indexOf(nota);
  if (i >= 0) item.notas.splice(i, 1); else item.notas.push(nota);

  if (nota === SIN_VEGETALES && item.notas.includes(nota)) {
    item.notas = item.notas.filter(n => !VEGETALES.includes(n));
  } else if (VEGETALES.includes(nota) && item.notas.includes(nota)) {
    item.notas = item.notas.filter(n => n !== SIN_VEGETALES);
  }

  document.querySelectorAll('#dlg-botones [data-nota]').forEach(b => {
    b.setAttribute('aria-pressed', item.notas.includes(b.dataset.nota));
  });
  pintarComanda();
}

function enviarACocina() {
  if (!destinoElegido || carrito.length === 0) return;
  const copiaCarrito = JSON.parse(JSON.stringify(carrito));
  const destino = destinoElegido;
  cambiar(() => {
    pedidos.push({
      id: Date.now(),
      turno: consecutivo++,
      destino,
      items: copiaCarrito,
      total: copiaCarrito.reduce((s, i) => s + i.precio * i.cant, 0),
      creado: Date.now(),
      actualizado: Date.now(),
      estado: 'cocinando'
    });
  });
  carrito = []; destinoElegido = null;
  pintarDestinos(); pintarProductos(); pintarComanda();
  mostrarAviso('Pedido enviado a cocina para ' + destino, false);
  anunciar('Pedido enviado');
  verPestana('curso');
}

/* ==========================================================
   7. LÓGICA DE COCINA Y TIQUETES
   ========================================================== */
function minutosDesde(ms) { return Math.floor((Date.now() - ms) / 60000); }
const ABIERTOS = ['cocinando', 'listo'];
const pedidosActivos = () => pedidos.filter(p => ABIERTOS.includes(p.estado));
const menuActivo = () => menu.filter(c => !c.eliminado);

function etiquetasNotas(notas) {
  if (!notas || !notas.length) return '';
  return '<span class="etiquetas">' + notas.map(n =>
    esPreparacion(n)
      ? `<span class="etq etq-prep">✂️ ${n}</span>`
      : `<span class="etq etq-quitar">⚠️ ${n}</span>`
  ).join('') + '</span>';
}

function tiquete(p, indice, vista) {
  const min = minutosDesde(p.creado);
  const listo = p.estado === 'listo';
  let cinta, clase;
  if (listo) { cinta = '✅ Listo para entregar'; clase = 'cinta-listo'; }
  else if (indice === 0) { cinta = '👉 Prepara este primero'; clase = 'cinta-ahora'; }
  else { cinta = 'En espera'; clase = 'cinta-espera'; }

  const acciones = vista === 'cocina'
    ? (listo
        ? `<button class="btn btn-papel menor" onclick="pedirConfirmacion(${p.id},'devolver')">Volver a preparar</button>`
        : `<button class="btn btn-verde" onclick="pedirConfirmacion(${p.id},'listo')">Ya está listo</button>
           <button class="btn btn-papel menor" onclick="pedirConfirmacion(${p.id},'cancelar')">Cancelar pedido</button>`)
    : (listo
        ? `<button class="btn btn-verde" onclick="pedirConfirmacion(${p.id},'entregar')">Se lo entregué al cliente</button>`
        : `<button class="btn btn-papel menor" onclick="pedirConfirmacion(${p.id},'cancelar')">Cancelar pedido</button>`);

  return `
  <article class="tiquete">
    <div class="cinta ${clase}"><span>${cinta}</span><span>${pesos(p.total)}</span></div>
    <div class="cuerpo">
      <div class="quien">
        <div>
          <h3>${p.destino}</h3>
          <p class="espera ${min >= 10 ? 'tarde' : ''}">${min === 0 ? 'Acaba de entrar' : 'Lleva ' + min + ' min'}</p>
        </div>
        <div class="turno">${p.turno}</div>
      </div>
      <ul class="items">
        ${p.items.map(i => `
          <li>
            <span class="cant">${i.cant}</span>
            <span>${i.nombre}${etiquetasNotas(i.notas)}</span>
          </li>`).join('')}
      </ul>
    </div>
    <div class="acciones">${acciones}</div>
  </article>`;
}

function pintarTiquetes() {
  const activos = pedidosActivos().sort((a, b) => a.creado - b.creado);
  if (rol === 'mostrador') {
    const listos = activos.filter(p => p.estado === 'listo');
    $('cuenta-curso').textContent = activos.length;
    $('aviso-listos').textContent = listos.length ? '✅ ' + listos.length + ' pedido(s) listos para entregar' : '';
    $('aviso-listos').classList.toggle('visible', listos.length > 0);

    const entregados = pedidos.filter(p => p.estado === 'entregado');
    const vendido = entregados.reduce((s, p) => s + p.total, 0);
    $('resumen-dia').innerHTML = entregados.length
      ? `<span>Entregados hoy<b>${entregados.length}</b></span><span>Vendido<b>${pesos(vendido)}</b></span>`
      : '';

    const orden = [...listos, ...activos.filter(p => p.estado !== 'listo')];
    const lista = $('lista-mostrador');
    lista.innerHTML = orden.length
      ? orden.map((p) => tiquete(p, activos.indexOf(p), 'mostrador')).join('')
      : `<div class="vacio-grande"><span class="emo">☕</span><b>No hay pedidos pendientes</b></div>`;
  }
  if (rol === 'cocina') {
    const porPreparar = activos.filter(p => p.estado === 'cocinando');
    $('cuenta-cocina').textContent = porPreparar.length;
    const orden = [...porPreparar, ...activos.filter(p => p.estado !== 'cocinando')];
    const lista = $('lista-cocina');
    lista.innerHTML = orden.length
      ? orden.map((p) => tiquete(p, porPreparar.indexOf(p), 'cocina')).join('')
      : `<div class="vacio-grande"><span class="emo">🍳</span><b>Cocina al día</b>No hay pedidos por preparar.</div>`;
    activos.forEach(p => idsVistosCocina.add(p.id));
  }
}

function pintar() {
  if (rol === 'mostrador') { pintarDestinos(); pintarProductos(); pintarComanda(); }
  if (rol === 'admin') { pintarMenuEditableAdmin(); calcularEstadisticasAdmin(); }
  pintarTiquetes();
}

/* ==========================================================
   8. VISTA Y LÓGICA DE ADMINISTRADOR (NUEVO MÓDULO)
   ========================================================== */
function calcularEstadisticasAdmin() {
  const entregados = pedidos.filter(p => p.estado === 'entregado');
  const ventasTotales = entregados.reduce((s, p) => s + p.total, 0);

  // Contador de productos más vendidos
  const mapaProductos = {};
  entregados.forEach(p => {
    p.items.forEach(item => {
      mapaProductos[item.nombre] = (mapaProductos[item.nombre] || 0) + item.cant;
    });
  });

  let topProducto = '-';
  let maxCant = 0;
  Object.entries(mapaProductos).forEach(([nombre, cant]) => {
    if (cant > maxCant) {
      maxCant = cant;
      topProducto = `${nombre} (${cant})`;
    }
  });

  if ($('stat-ventas'))$('stat-ventas').textContent = pesos(ventasTotales);
  if ($('stat-pedidos'))$('stat-pedidos').textContent = entregados.length;
  if ($('stat-top-producto'))$('stat-top-producto').textContent = topProducto;
}

function pintarMenuEditableAdmin() {
  const cont = $('lista-menu-admin');
  if (!cont) return;
  const lista = menuActivo();
  cont.innerHTML = lista.length ? lista.map(p => `
    <div class="fila-menu">
      <span class="emo" aria-hidden="true">${p.emo}</span>
      <span class="datos"><b>${p.nombre}</b><span>${pesos(p.precio)}</span></span>
      <span class="btns">
        <button class="b-cambiar" onclick="editarComida(${p.id})">Cambiar</button>
        <button class="b-quitar" onclick="confirmarQuitarComida(${p.id})">Quitar</button>
      </span>
    </div>`).join('')
    : `<div class="vacio-grande"><span class="emo">📝</span><b>El menú está vacío</b>Toca “Agregar Producto”.</div>`;
}

/* ==========================================================
   9. EDITOR Y FORMULARIO DE PRODUCTOS
   ========================================================== */
const ICONOS = ['🍔', '🌭', '🍟', '🍗', '🥪', '🌮', '🥤', '🧃', '☕', '🍰', '💧', '🍦'];
let comidaEditando = null;
let precioBorrador = 0;
let tipoBorrador = 'hamburguesa';
let emoBorrador = '🍔';

function nuevaComida() {
  comidaEditando = null;
  precioBorrador = 0; tipoBorrador = 'hamburguesa'; emoBorrador = '🍔';
  $('form-titulo').textContent = 'Nueva comida';$('campo-nombre').value = '';
  abrirFormulario();
}

function editarComida(id) {
  const c = menu.find(x => x.id === id);
  if (!c) return;
  comidaEditando = id;
  precioBorrador = c.precio; tipoBorrador = c.tipo; emoBorrador = c.emo;
  $('form-titulo').textContent = 'Cambiar comida';$('campo-nombre').value = c.nombre;
  abrirFormulario();
}

function abrirFormulario() {
  mostrarPantalla('form-comida');
  pintarTeclado(); pintarVisor(); pintarTipos(); pintarIconos(); revisarFormulario();
}

function cerrarFormulario() {
  if (rol === 'admin') mostrarPantalla('administrador');
  else mostrarPantalla('mostrador');
  pintar();
}

function pintarTeclado() {
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'borrar'];
  $('teclado').innerHTML = teclas.map(t => t === 'borrar'
    ? `<button class="tecla-borrar" onclick="teclaPrecio('borrar')">← Borrar</button>`
    : `<button onclick="teclaPrecio('${t}')">${t}</button>`).join('');
}

function teclaPrecio(t) {
  if (t === 'borrar') precioBorrador = Math.floor(precioBorrador / 10);
  else {
    const nuevo = Number(String(precioBorrador) + t);
    if (nuevo <= 9999999) precioBorrador = nuevo;
  }
  pintarVisor(); revisarFormulario();
}

function pintarVisor() { $('visor-precio').textContent = pesos(precioBorrador); }

function pintarTipos() {
  const tipos = [{ v: 'hamburguesa', t: 'Comida principal' }, { v: 'plato', t: 'Acompañamiento' }, { v: 'bebida', t: 'Bebida' }];
  $('rejilla-tipo').innerHTML = tipos.map(x => `
    <button class="chip chip-ancho" aria-pressed="${tipoBorrador === x.v}"
            onclick="tipoBorrador='${x.v}';pintarTipos()">${x.t}</button>`).join('');
}

function pintarIconos() {
  $('rejilla-emo').innerHTML = ICONOS.map(e => `
    <button class="chip" style="font-size:2rem" aria-pressed="${emoBorrador === e}"
            onclick="emoBorrador='${e}';pintarIconos()">${e}</button>`).join('');
}

function revisarFormulario() {
  const ok = $('campo-nombre').value.trim().length > 0 && precioBorrador > 0;
  $('btn-guardar').disabled = !ok;
}

function guardarComida() {
  const nombre = $('campo-nombre').value.trim();
  if (!nombre || precioBorrador <= 0) return;
  const id = comidaEditando;
  const datos = { nombre, precio: precioBorrador, tipo: tipoBorrador, emo: emoBorrador };

  cambiar(() => {
    if (id) {
      const c = menu.find(x => x.id === id);
      if (c) Object.assign(c, datos, { actualizado: Date.now() });
    } else {
      menu.push({ id: Date.now(), ...datos, actualizado: Date.now() });
    }
  });

  mostrarAviso((id ? 'Cambiaste ' : 'Agregaste ') + nombre, false);
  cerrarFormulario();
}

function confirmarQuitarComida(id) {
  const c = menu.find(x => x.id === id);
  if (!c) return;
  abrirDialogo('¿Quitar del menú?', c.nombre + ' — ' + pesos(c.precio),
    `<button class="btn btn-rojo btn-xl" onclick="quitarComida(${id})">Sí, quitarla</button>
     <button class="btn btn-papel" onclick="cerrarDialogo()">No, dejarla</button>`);
}

function quitarComida(id) {
  cerrarDialogo();
  const c = menu.find(x => x.id === id);
  if (!c) return;
  const nombre = c.nombre;
  cambiar(() => {
    const c2 = menu.find(x => x.id === id);
    if (c2) { c2.eliminado = true; c2.actualizado = Date.now(); }
  });
  pintar();
  mostrarAviso('Quitaste ' + nombre + ' del menú', true);
}

/* ==========================================================
   10. CONFIRMACIONES Y ACCIONES DE ESTADO DE PEDIDOS
   ========================================================== */
const TEXTOS = {
  listo: { t: '¿El pedido ya está listo?', b: 'Sí, está listo', clase: 'btn-verde' },
  entregar: { t: '¿Ya se lo entregaste?', b: 'Sí, ya lo entregué', clase: 'btn-verde' },
  cancelar: { t: '¿Cancelar este pedido?', b: 'Sí, cancelarlo', clase: 'btn-rojo' },
  devolver: { t: '¿Volver a prepararlo?', b: 'Sí, volver a cocina', clase: 'btn-mostaza' }
};

function pedirConfirmacion(id, accion) {
  const p = pedidos.find(x => x.id === id);
  if (!p) return;
  const c = TEXTOS[accion];
  abrirDialogo(c.t, `Turno ${p.turno} · ${p.destino}`,
    `<button class="btn ${c.clase} btn-xl" onclick="ejecutar(${id},'${accion}')">${c.b}</button>
     <button class="btn btn-papel" onclick="cerrarDialogo()">No, volver</button>`);
}

function ejecutar(id, accion) {
  cerrarDialogo();
  const antes = JSON.parse(JSON.stringify(pedidos));
  const p = pedidos.find(x => x.id === id);
  if (!p) return;
  const etiqueta = `Turno ${p.turno} · ${p.destino}`;

  cambiar(() => {
    const q = pedidos.find(x => x.id === id);
    if (!q) return;
    if (accion === 'listo') q.estado = 'listo';
    if (accion === 'devolver') q.estado = 'cocinando';
    if (accion === 'entregar') q.estado = 'entregado';
    if (accion === 'cancelar') q.estado = 'cancelado';
    q.actualizado = Date.now();
  });

  ultimaAccion = antes;
  const mensajes = { listo: 'Marcado como listo', entregar: 'Pedido entregado', cancelar: 'Pedido cancelado', devolver: 'Volvió a la cocina' };
  mostrarAviso(mensajes[accion] + ' — ' + etiqueta, true);
  anunciar(mensajes[accion]);
}

function deshacer() {
  if (ultimaAccion) {
    const restaurar = ultimaAccion.map(p => ({ ...p, actualizado: Date.now() }));
    cambiar(() => { pedidos = restaurar; });
    ultimaAccion = null;
  }
  ocultarAviso();
  anunciar('Se deshizo el cambio');
}

/* ==========================================================
   11. MODAL, NOTIFICACIONES Y SONIDO
   ========================================================== */
function abrirDialogo(titulo, texto, botonesHTML) {
  $('dlg-titulo').textContent = titulo;
  $('dlg-texto').textContent = texto;
  $('dlg-botones').innerHTML = botonesHTML;
  $('velo').classList.add('abierto');
}

function cerrarDialogo() { $('velo').classList.remove('abierto'); }

function mostrarAviso(texto, conDeshacer) {
  $('aviso-texto').textContent = texto;
  $('aviso').querySelector('button').classList.toggle('oculto', !conDeshacer);$('aviso').classList.add('visible');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(ocultarAviso, conDeshacer ? 12000 : 5000);
}

function ocultarAviso() { $('aviso').classList.remove('visible'); }
function anunciar(t) { $('anuncio').textContent = t; }

function alternarSonido() {
  sonidoActivo = !sonidoActivo;
  $('btn-sonido').textContent = sonidoActivo ? '🔔 Sonido' : '🔕 Silencio';
}

function avisarPedidoNuevo() {
  const hayNuevo = pedidosActivos().some(p => !idsVistosCocina.has(p.id));
  if (!hayNuevo) return;
  pedidosActivos().forEach(p => idsVistosCocina.add(p.id));

  const banner = $('banner-nuevo');
  banner.classList.add('visible');
  clearTimeout(window._tBanner);
  window._tBanner = setTimeout(() => banner.classList.remove('visible'), 8000);

  if (!sonidoActivo) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1174].forEach((hz, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = hz; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.35);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.4);
    });
  } catch (e) {}
  anunciar('Entró un pedido nuevo');
}

/* ==========================================================
   12. ARRANQUE DE LA APLICACIÓN
   ========================================================== */
(async function () {
  const remoto = await leerRemoto();
  if (remoto) aplicarRemoto(remoto);
  await escribirRemoto();
  pintarConexion();
})();