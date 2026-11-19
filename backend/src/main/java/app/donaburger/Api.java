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

import org.springframework.beans.factory.annotation.Value;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/* Los DTOs definen el contrato HTTP sin exponer las entidades JPA. */
record LoginRequest(@NotBlank String rol, @NotBlank String pin) {}
record LoginResponse(String rol, String token, OffsetDateTime expiraEn) {}
record SesionResponse(String rol, OffsetDateTime expiraEn) {}
record MenuRequest(
        @NotBlank(message = "Escribe el nombre del producto") String nombre,
        @NotNull(message = "Escribe un precio") @PositiveOrZero(message = "El precio no puede ser negativo") Integer precio,
        String emo,
        @NotBlank(message = "Selecciona un tipo de producto") String tipo,
        @PositiveOrZero(message = "El stock no puede ser negativo") Integer stock) {}
record ItemRequest(
        @NotNull(message = "Selecciona un producto") Long id_prod,
        @NotNull(message = "Indica la cantidad") @Positive(message = "La cantidad debe ser mayor que cero") Integer cant,
        List<String> notas) {}
record PedidoRequest(
        @NotBlank(message = "Escribe el destino del pedido") String destino,
        @NotEmpty(message = "Agrega al menos un producto") List<@Valid ItemRequest> items) {}
record CotizarRequest(@NotEmpty(message = "Agrega al menos un producto") List<@Valid ItemRequest> items) {}
record EstadoRequest(@NotBlank(message = "Indica el estado") String estado) {}
record GrupoCambios(String titulo, String emo, List<String> tipos, List<String> opciones) {}
record CotizacionItem(Long id_prod, String nombre, Integer precio, Integer cant, List<String> notas) {}
record CotizacionResponse(Integer total, List<CotizacionItem> items) {}

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
    private static final ZoneId RESTAURANT_ZONE = ZoneId.of("America/Bogota");
    private static final Set<String> ROLES = Set.of("mostrador", "cocina", "admin");

    private final UsuarioRepo usuarios;
    private final long sessionTtlSeconds;
    private final ConcurrentHashMap<String, SesionActiva> sesiones = new ConcurrentHashMap<>();

    record SesionActiva(String rol, Instant expiraEn) {}

    AuthService(
            UsuarioRepo usuarios,
            @Value("${SESSION_TTL_SECONDS:28800}") long sessionTtlSeconds) {
        this.usuarios = usuarios;
        this.sessionTtlSeconds = sessionTtlSeconds;
    }

    LoginResponse login(LoginRequest request) {
        if (!ROLES.contains(request.rol())) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Rol inválido");
        }

        Usuario usuario = usuarios.findByRolAndPinAndActivoTrue(request.rol(), request.pin())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "PIN incorrecto"));

        Instant ahora = Instant.now();
        sesiones.entrySet().removeIf(entry -> ahora.isAfter(entry.getValue().expiraEn()));

        String token = UUID.randomUUID().toString();
        Instant expira = ahora.plusSeconds(sessionTtlSeconds);
        sesiones.put(token, new SesionActiva(usuario.rol, expira));

        return new LoginResponse(
                usuario.rol,
                token,
                expira.atZone(RESTAURANT_ZONE).toOffsetDateTime());
    }

    SesionActiva validarToken(String authorization) {
        String token = extraerBearer(authorization);
        if (token == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Inicia sesión para continuar");
        }

        SesionActiva sesion = sesiones.get(token);
        if (sesion == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Sesión inválida o cerrada");
        }

        if (Instant.now().isAfter(sesion.expiraEn())) {
            sesiones.remove(token);
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Tu sesión expiró. Inicia sesión nuevamente");
        }
        return sesion;
    }

    SesionResponse obtenerSesion(String authorization) {
        SesionActiva sesion = validarToken(authorization);
        return new SesionResponse(
                sesion.rol(),
                sesion.expiraEn().atZone(RESTAURANT_ZONE).toOffsetDateTime());
    }

    void logout(String authorization) {
        String token = extraerBearer(authorization);
        if (token != null) {
            sesiones.remove(token);
        }
    }

    private String extraerBearer(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return null;
        }
        String token = authorization.substring(7).trim();
        return token.isEmpty() ? null : token;
    }
}

@RestController
@RequestMapping("/api/auth")
class AuthController {
    private final AuthService authService;

    AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    LoginResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    @GetMapping("/sesion")
    SesionResponse sesion(@RequestHeader(value = "Authorization", required = false) String authorization) {
        return authService.obtenerSesion(authorization);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        authService.logout(authorization);
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
        if (request.stock() != null) {
         producto.stock = request.stock();
     } else if (id == null) {
         producto.stock = 0;
     }
        producto.actualizado = OffsetDateTime.now();
        return menu.save(producto);
    }

    void eliminarProducto(Long id) {
        Producto producto = menu.findById(id).orElseThrow(() -> notFound("Producto no encontrado"));
        producto.eliminado = true;
        producto.actualizado = OffsetDateTime.now();
        menu.save(producto);
    }

    List<Pedido> listarPedidos(String estado, boolean hoy) {
        if (hoy) {
            OffsetDateTime inicio = LocalDate.now(RESTAURANT_ZONE)
                    .atStartOfDay(RESTAURANT_ZONE)
                    .toOffsetDateTime();
            return pedidos.findByCreadoGreaterThanEqualOrderByCreadoDesc(inicio);
        }

        if (estado != null && !estado.isBlank()) {
            List<String> estadosSolicitados = List.of(estado.split(","));
            if (!ORDER_STATES.containsAll(estadosSolicitados)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Filtro de estado inválido");
            }
            return pedidos.findByEstadoInOrderByCreadoAsc(estadosSolicitados);
        }
        return pedidos.findAllByOrderByCreadoAsc();
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
     Map<Long, Integer> cantidadesPorProducto = new TreeMap<>();
     for (ItemRequest item : request.items()) {
         cantidadesPorProducto.merge(item.id_prod(), item.cant(), Math::addExact);
     }

     Map<Long, Producto> productosBloqueados = new LinkedHashMap<>();
     for (Map.Entry<Long, Integer> entry : cantidadesPorProducto.entrySet()) {
         Long idProd = entry.getKey();
         int cantSolicitada = entry.getValue();

         Producto producto = menu.findByIdForUpdate(idProd)
                 .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Producto no disponible"));

         int stockActual = producto.stock == null ? 0 : producto.stock;
         if (stockActual < cantSolicitada) {
             throw new ResponseStatusException(
                     HttpStatus.CONFLICT,
                     "Stock insuficiente para " + producto.nombre + " (disponible: " + stockActual + ")");
         }
         productosBloqueados.put(idProd, producto);
     }

     List<CotizacionItem> itemsCotizados = new ArrayList<>();
     int total = 0;
     for (ItemRequest solicitado : request.items()) {
         Producto producto = productosBloqueados.get(solicitado.id_prod());
         List<String> notas = normalizarNotas(producto.tipo, solicitado.notas());
         total = Math.addExact(total, Math.multiplyExact(producto.precio, solicitado.cant()));
         itemsCotizados.add(new CotizacionItem(
                 producto.id, producto.nombre, producto.precio, solicitado.cant(), notas));
     }

     OffsetDateTime ahora = OffsetDateTime.now(RESTAURANT_ZONE);
     for (Map.Entry<Long, Integer> entry : cantidadesPorProducto.entrySet()) {
         Producto producto = productosBloqueados.get(entry.getKey());
         producto.stock = producto.stock - entry.getValue();
         producto.actualizado = ahora;
         menu.save(producto);
     }

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
     pedido.total = total;
     pedido.creado = ahora;
     pedido.actualizado = ahora;

     for (CotizacionItem cotizado : itemsCotizados) {
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

        // Si llegan notas incompatibles, prevalece la opción de vegetales seleccionada al final.
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
    private final AppService service;
    private final AuthService authService;

    ApiController(AppService service, AuthService authService) {
        this.service = service;
        this.authService = authService;
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
private String exigirRol(String authorization) {
        return authService.validarToken(authorization).rol();
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
