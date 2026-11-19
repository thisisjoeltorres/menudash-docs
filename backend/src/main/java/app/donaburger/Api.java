package app.donaburger;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/* Los DTOs definen el contrato HTTP sin exponer las entidades JPA. */
class LoginRequest {
    @NotBlank public String rol;
    @NotBlank public String pin;

    public String rol() { return rol; }
    public String pin() { return pin; }
}

class LoginResponse {
    public String rol;
    public String token;

    public LoginResponse(String rol, String token) {
        this.rol = rol;
        this.token = token;
    }
}

class MenuRequest {
    @NotBlank(message = "Escribe el nombre del producto")
    public String nombre;

    @NotNull(message = "Escribe un precio")
    @PositiveOrZero(message = "El precio no puede ser negativo")
    public Integer precio;

    public String emo;

    @NotBlank(message = "Selecciona un tipo de producto")
    public String tipo;

    public String nombre() { return nombre; }
    public Integer precio() { return precio; }
    public String emo() { return emo; }
    public String tipo() { return tipo; }
}

class ItemRequest {
    @NotNull(message = "Selecciona un producto")
    public Long id_prod;

    @NotNull(message = "Indica la cantidad")
    @Positive(message = "La cantidad debe ser mayor que cero")
    public Integer cant;

    public List<String> notas;

    public Long id_prod() { return id_prod; }
    public Integer cant() { return cant; }
    public List<String> notas() { return notas; }
}

class PedidoRequest {
    @NotBlank(message = "Escribe el destino del pedido")
    public String destino;

    @NotEmpty(message = "Agrega al menos un producto")
    public List<@Valid ItemRequest> items;

    public String destino() { return destino; }
    public List<ItemRequest> items() { return items; }
}

class CotizarRequest {
    @NotEmpty(message = "Agrega al menos un producto")
    public List<@Valid ItemRequest> items;

    public List<ItemRequest> items() { return items; }
}

class EstadoRequest {
    @NotBlank(message = "Indica el estado")
    public String estado;

    public String estado() { return estado; }
}

class GrupoCambios {
    public String titulo;
    public String emo;
    public List<String> tipos;
    public List<String> opciones;

    public GrupoCambios(String titulo, String emo, List<String> tipos, List<String> opciones) {
        this.titulo = titulo;
        this.emo = emo;
        this.tipos = tipos;
        this.opciones = opciones;
    }

    public List<String> tipos() { return tipos; }
    public List<String> opciones() { return opciones; }
}

class CotizacionItem {
    public Long id_prod;
    public String nombre;
    public Integer precio;
    public Integer cant;
    public List<String> notas;

    public CotizacionItem(Long id_prod, String nombre, Integer precio, Integer cant, List<String> notas) {
        this.id_prod = id_prod;
        this.nombre = nombre;
        this.precio = precio;
        this.cant = cant;
        this.notas = notas;
    }

    public Long id_prod() { return id_prod; }
    public String nombre() { return nombre; }
    public Integer precio() { return precio; }
    public Integer cant() { return cant; }
    public List<String> notas() { return notas; }
}

class CotizacionResponse {
    public Integer total;
    public List<CotizacionItem> items;

    public CotizacionResponse(Integer total, List<CotizacionItem> items) {
        this.total = total;
        this.items = items;
    }

    public Integer total() { return total; }
    public List<CotizacionItem> items() { return items; }
}

/* Devuelve los errores esperados de la API con un mensaje JSON uniforme. */
@RestControllerAdvice
class ApiErrorHandler {
  @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, String>> handle(ResponseStatusException exception) {
        String message = Optional.ofNullable(exception.getReason()).orElse("Solicitud inválida");
        return ResponseEntity.status(exception.getStatusCode()).body(Map.of("message", message));
    }

   @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> handleValidation(MethodArgumentNotValidException exception) {
        String message = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getDefaultMessage())
                .findFirst()
                .orElse("Revisa los datos enviados");
        return ResponseEntity.badRequest().body(Map.of("message", message));
    }
}

@Service
class AuthService {
    private static final Set<String> ROLES = Set.of("mostrador", "cocina", "admin");
    private final UsuarioRepo usuarios;

    AuthService(UsuarioRepo usuarios) {
        this.usuarios = usuarios;
    }

    LoginResponse login(LoginRequest request) {
        if (!ROLES.contains(request.rol())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Rol inválido");
        }

        Usuario usuario = usuarios.findByRolAndPinAndActivoTrue(request.rol(), request.pin())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "PIN incorrecto"));

        return new LoginResponse(usuario.rol, java.util.UUID.randomUUID().toString());
    }
}

@RestController
@RequestMapping("/api/auth")
class AuthController {
    private final AuthService authService;

    AuthController(AuthService authService) {
        this.authService = authService;
    }

    // TODO: [TAREA PARA COMPAÑERO 4] Guardar el token con rol y expiración, validarlo en cada petición y revocarlo al cerrar sesión. No aceptar X-Role sin token válido.
    @PostMapping("/login")
    LoginResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }
}

@Service
class AppService {
    private static final ZoneId RESTAURANT_ZONE = ZoneId.of("America/Bogota");
    private static final String NOTA_SIN_VEGETALES = "Sin nada de vegetales";
    private static final Set<String> NOTAS_VEGETALES = Set.of(
            "Sin cebolla", "Sin tomate", "Sin lechuga", "Sin pepinillos");
    private static final List<GrupoCambios> GRUPOS_CAMBIOS = List.of(
            new GrupoCambios("Quitar", "🚫", List.of("hamburguesa", "plato"), List.of(
                    "Sin cebolla", "Sin tomate", "Sin lechuga", "Sin pepinillos",
                    "Sin salsas", "Sin queso", "Sin sal", NOTA_SIN_VEGETALES)),
            new GrupoCambios("Agregar", "➕", List.of("hamburguesa", "plato"), List.of(
                    "Extra queso", "Extra carne", "Extra tocineta", "Salsas aparte", "Extra salsas")),
            new GrupoCambios("Cómo prepararla", "👩‍🍳", List.of("hamburguesa", "plato"), List.of(
                    "Partida a la mitad", "Bien asada", "Término medio", "Sin tostar el pan", "Empacada aparte")),
            new GrupoCambios("Cómo servirla", "🥤", List.of("bebida"), List.of(
                    "Sin hielo", "Con hielo", "Bien fría", "Sin pitillo")));
    private static final Set<String> MENU_TYPES = Set.of("hamburguesa", "plato", "bebida");
    private static final List<String> MENU_TYPE_OPTIONS = List.of("hamburguesa", "plato", "bebida");
    private static final Set<String> ORDER_STATES = Set.of("cocinando", "listo", "entregado", "cancelado");

    private final MenuRepo menu;
    private final PedidoRepo pedidos;

    AppService(MenuRepo menu, PedidoRepo pedidos) {
        this.menu = menu;
        this.pedidos = pedidos;
    }

    List<Producto> listarMenu() {
        return menu.findByEliminadoFalseOrderByIdAsc();
    }

    List<String> listarTiposMenu() {
        return MENU_TYPE_OPTIONS;
    }

    List<GrupoCambios> listarCambios() {
        return GRUPOS_CAMBIOS;
    }

    List<String> listarDestinosRapidos() {
        return List.of("Para llevar", "Domicilio", "Come aquí");
    }

    Producto guardarProducto(Long id, MenuRequest request) {
        if (!MENU_TYPES.contains(request.tipo())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Tipo de producto inválido");
        }

        Producto producto = id == null
                ? new Producto()
                : menu.findById(id).orElseThrow(() -> notFound("Producto no encontrado"));

        producto.nombre = request.nombre().trim();
        producto.precio = request.precio();
        producto.emo = request.emo() == null || request.emo().isBlank() ? "🍽️" : request.emo().trim();
        producto.tipo = request.tipo();
        producto.actualizado = OffsetDateTime.now();
        return menu.save(producto);
    }

    void eliminarProducto(Long id) {
        Producto producto = menu.findById(id).orElseThrow(() -> notFound("Producto no encontrado"));
        producto.eliminado = true;
        producto.actualizado = OffsetDateTime.now();
        menu.save(producto);
    }

    @Transactional(readOnly = true)
    List<Pedido> listarPedidos(String desde, String hasta, String estado, String busqueda, boolean hoy) {
        LocalDate fechaDesde = parsearFechaOpcional(desde, "desde");
        LocalDate fechaHasta = parsearFechaOpcional(hasta, "hasta");

        if (hoy && fechaDesde == null && fechaHasta == null) {
            LocalDate hoyBogota = LocalDate.now(RESTAURANT_ZONE);
            fechaDesde = hoyBogota;
            fechaHasta = hoyBogota;
        }

        if (fechaDesde != null && fechaHasta != null && fechaDesde.isAfter(fechaHasta)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La fecha 'desde' no puede ser mayor que 'hasta'");
        }

        OffsetDateTime inicioRango = fechaDesde != null
                ? fechaDesde.atStartOfDay(RESTAURANT_ZONE).toOffsetDateTime()
                : null;
        OffsetDateTime finExclusivoRango = fechaHasta != null
                ? fechaHasta.plusDays(1).atStartOfDay(RESTAURANT_ZONE).toOffsetDateTime()
                : null;

        boolean filtrarEstados = false;
        List<String> estadosFiltrados = ORDER_STATES.stream().toList();
        if (estado != null && !estado.isBlank()) {
            List<String> solicitados = Arrays.stream(estado.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .toList();
            if (solicitados.isEmpty() || !ORDER_STATES.containsAll(solicitados)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Filtro de estado inválido");
            }
            filtrarEstados = true;
            estadosFiltrados = solicitados;
        }

        String termino = (busqueda == null || busqueda.isBlank())
                ? null
                : busqueda.trim().toLowerCase(Locale.ROOT);

        return pedidos.buscarHistorial(inicioRango, finExclusivoRango, filtrarEstados, estadosFiltrados, termino);
    }

    /** Cotiza con precios consultados en PostgreSQL; el navegador nunca envía precios. */
    @Transactional(readOnly = true)
    CotizacionResponse cotizar(List<ItemRequest> itemsSolicitados) {
        List<CotizacionItem> itemsCotizados = new ArrayList<>();
        int total = 0;

        for (ItemRequest solicitado : itemsSolicitados) {
            Producto producto = productoDisponible(solicitado.id_prod());
            List<String> notas = normalizarNotas(producto.tipo, solicitado.notas());
            total = Math.addExact(total, Math.multiplyExact(producto.precio, solicitado.cant()));
            itemsCotizados.add(new CotizacionItem(
                    producto.id, producto.nombre, producto.precio, solicitado.cant(), notas));
        }
        return new CotizacionResponse(total, itemsCotizados);
    }

    /** Crea el pedido y sus productos en una transacción con precios y turno calculados en Java. */
    @Transactional
    Pedido crearPedido(PedidoRequest request) {
        CotizacionResponse cotizacion = cotizar(request.items());

        if (pedidos.bloquearTurno().isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.INTERNAL_SERVER_ERROR, "Falta el usuario admin semilla para asignar turnos");
        }
        LocalDate hoy = LocalDate.now(RESTAURANT_ZONE);
        int siguienteTurno = pedidos.maxTurnoHoy(java.sql.Date.valueOf(hoy)) + 1;

        Pedido pedido = new Pedido();
        pedido.turno = siguienteTurno;
        pedido.destino = request.destino().trim();
        pedido.estado = "cocinando";
        pedido.total = cotizacion.total();
        pedido.creado = OffsetDateTime.now(RESTAURANT_ZONE);
        pedido.actualizado = pedido.creado;

        for (CotizacionItem cotizado : cotizacion.items()) {
            ItemPedido item = new ItemPedido();
            item.pedido = pedido;
            item.idProd = cotizado.id_prod();
            item.nombre = cotizado.nombre();
            item.precio = cotizado.precio();
            item.cant = cotizado.cant();
            item.notas = cotizado.notas().toArray(String[]::new);
            pedido.items_pedido.add(item);
        }
        return pedidos.save(pedido);
    }

    /** Valida aquí las transiciones por rol; la solicitud del cliente no autoriza cambios. */
    Pedido cambiarEstado(Long id, String estadoNuevo, String rol) {
        if (!ORDER_STATES.contains(estadoNuevo)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Estado inválido");
        }
        Pedido pedido = pedidos.findById(id).orElseThrow(() -> notFound("Pedido no encontrado"));
        boolean permitido = switch (rol) {
            case "admin" -> true;
            case "cocina" -> (pedido.estado.equals("cocinando") && estadoNuevo.equals("listo"))
                    || (pedido.estado.equals("listo") && estadoNuevo.equals("cocinando"));
            case "mostrador" -> (pedido.estado.equals("listo") && estadoNuevo.equals("entregado"))
                    || (Set.of("cocinando", "listo").contains(pedido.estado) && estadoNuevo.equals("cancelado"));
            default -> false;
        };

        if (!permitido) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Transición no permitida para el rol");
        }
        pedido.estado = estadoNuevo;
        pedido.actualizado = OffsetDateTime.now(RESTAURANT_ZONE);
        return pedidos.save(pedido);
    }

    // TODO: [TAREA PARA COMPAÑERO 1] Calcular ventas entregadas, cantidad y promedio de tickets, y producto más vendido para hoy. Excluir cancelados y devolver un DTO de estadísticas.
    // TODO: [TAREA PARA COMPAÑERO 3] Añadir stock/disponibilidad en Producto y descontarlo en esta transacción; rechazar pedidos que excedan existencias.

    private LocalDate parsearFechaOpcional(String valor, String nombreParametro) {
        if (valor == null || valor.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(valor.trim());
        } catch (DateTimeParseException ex) {
            throw new ResponseStatusException(
                    HttpStatus.BAD_REQUEST,
                    "Parámetro '" + nombreParametro + "' inválido; usa formato YYYY-MM-DD");
        }
    }

    private Producto productoDisponible(Long id) {
        return menu.findById(id)
                .filter(producto -> !producto.eliminado)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Producto no disponible"));
    }

    /** Acepta solo opciones del catálogo del servidor y resuelve notas incompatibles. */
    private List<String> normalizarNotas(String tipoProducto, List<String> notasRecibidas) {
        if (notasRecibidas == null || notasRecibidas.isEmpty()) {
            return List.of();
        }

        Set<String> permitidas = new LinkedHashSet<>();
        GRUPOS_CAMBIOS.stream()
                .filter(grupo -> grupo.tipos().contains(tipoProducto))
                .forEach(grupo -> permitidas.addAll(grupo.opciones()));

        LinkedHashSet<String> notasUnicas = new LinkedHashSet<>();
        for (String nota : notasRecibidas) {
            if (nota == null || !permitidas.contains(nota)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cambio no válido para este producto");
            }
            notasUnicas.add(nota);
        }

        int indiceGeneral = notasRecibidas.lastIndexOf(NOTA_SIN_VEGETALES);
        int indiceVegetal = -1;
        for (int i = 0; i < notasRecibidas.size(); i++) {
            if (NOTAS_VEGETALES.contains(notasRecibidas.get(i))) {
                indiceVegetal = i;
            }
        }
        if (indiceGeneral >= 0 && indiceVegetal >= 0) {
            if (indiceGeneral > indiceVegetal) {
                notasUnicas.removeAll(NOTAS_VEGETALES);
            } else {
                notasUnicas.remove(NOTA_SIN_VEGETALES);
            }
        }
        return List.copyOf(notasUnicas);
    }

    private ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }
}

@RestController
@RequestMapping("/api")
class ApiController {
    private static final Set<String> ROLES = Set.of("mostrador", "cocina", "admin");
    private final AppService service;

    ApiController(AppService service) {
        this.service = service;
    }

    @GetMapping("/menu")
    List<Producto> menu() {
        return service.listarMenu();
    }

    @GetMapping("/menu/tipos")
    List<String> tiposMenu() {
        return service.listarTiposMenu();
    }

    @GetMapping("/menu/cambios")
    List<GrupoCambios> cambiosPermitidos() {
        return service.listarCambios();
    }

    @GetMapping("/pedidos/destinos")
    List<String> destinosRapidos() {
        return service.listarDestinosRapidos();
    }

    // TODO: [TAREA PARA COMPAÑERO 1] Agregar GET /api/admin/estadisticas protegido para admin y conectar el DTO de métricas de AppService.

    @PostMapping("/menu")
    Producto crearProducto(@RequestHeader("X-Role") String rol, @Valid @RequestBody MenuRequest request) {
        exigirAdmin(rol);
        return service.guardarProducto(null, request);
    }

    @PutMapping("/menu/{id}")
    Producto editarProducto(
            @RequestHeader("X-Role") String rol,
            @PathVariable Long id,
            @Valid @RequestBody MenuRequest request) {
        exigirAdmin(rol);
        return service.guardarProducto(id, request);
    }

    @DeleteMapping("/menu/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void eliminarProducto(@RequestHeader("X-Role") String rol, @PathVariable Long id) {
        exigirAdmin(rol);
        service.eliminarProducto(id);
    }

    @PostMapping("/pedidos/cotizar")
    CotizacionResponse cotizar(
            @RequestHeader("X-Role") String rol,
            @Valid @RequestBody CotizarRequest request) {
        exigirRol(rol);
        return service.cotizar(request.items());
    }

    @PostMapping("/pedidos")
    @ResponseStatus(HttpStatus.CREATED)
    Pedido crearPedido(
            @RequestHeader("X-Role") String rol,
            @Valid @RequestBody PedidoRequest request) {
        if (!Set.of("mostrador", "admin").contains(exigirRol(rol))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No autorizado para crear pedidos");
        }
        return service.crearPedido(request);
    }

    @GetMapping("/pedidos")
    List<Pedido> pedidos(
            @RequestHeader("X-Role") String rol,
            @RequestParam(required = false) String desde,
            @RequestParam(required = false) String hasta,
            @RequestParam(required = false) String estado,
            @RequestParam(required = false) String busqueda,
            @RequestParam(defaultValue = "false") boolean hoy) {
        exigirRol(rol);
        return service.listarPedidos(desde, hasta, estado, busqueda, hoy);
    }

    @PatchMapping("/pedidos/{id}/estado")
    Pedido cambiarEstado(
            @RequestHeader("X-Role") String rol,
            @PathVariable Long id,
            @Valid @RequestBody EstadoRequest request) {
        return service.cambiarEstado(id, request.estado(), exigirRol(rol));
    }

    private void exigirAdmin(String rol) {
        if (!"admin".equals(exigirRol(rol))) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo admin puede gestionar el menú");
        }
    }

    private String exigirRol(String rol) {
        if (!ROLES.contains(rol)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Inicia sesión para continuar");
        }
        return rol;
    }
}

@org.springframework.context.annotation.Configuration
class WebConfig implements org.springframework.web.servlet.config.annotation.WebMvcConfigurer {
    @Override
    public void addCorsMappings(org.springframework.web.servlet.config.annotation.CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }
}
