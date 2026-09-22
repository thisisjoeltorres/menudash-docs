-- =========================================================
-- MODELO RELACIONAL: App de gestión de pedidos en tiempo real
-- Proyecto: Desarrollo Orientado a Plataformas
-- Motor: MySQL 8.0 (InnoDB) — versión para MySQL Workbench
--
-- NOTA: esta es una adaptación de la versión original en
-- PostgreSQL/Supabase. Diferencias clave:
--   - No existe auth.users (eso es de Supabase Auth), así que
--     "usuarios.id" aquí es un CHAR(36) con UUID generado en
--     MySQL, no una FK a un sistema de autenticación externo.
--   - Los ENUM se declaran directo en la columna (sintaxis MySQL).
--   - "actualizado_en" se auto-actualiza con ON UPDATE
--     CURRENT_TIMESTAMP, sin necesidad de trigger.
--   - Los triggers se separan por evento (INSERT/UPDATE/DELETE)
--     porque MySQL no permite combinarlos en uno solo.
-- =========================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------
-- 1. USUARIOS DEL RESTAURANTE (mesero, cocina, administrador)
-- ---------------------------------------------------------
CREATE TABLE usuarios (
    id              CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    correo          VARCHAR(150) NOT NULL,
    rol             ENUM('mesero', 'cocina', 'administrador') NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_usuarios_correo (correo)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- 2. CLIENTES (flujo público, sin password)
-- ---------------------------------------------------------
CREATE TABLE clientes (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    nombre     VARCHAR(150) NOT NULL,
    telefono   VARCHAR(20) NOT NULL,
    creado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_clientes_telefono (telefono)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- 3. CATÁLOGO: categorías y productos
-- ---------------------------------------------------------
CREATE TABLE categorias_productos (
    id     INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    UNIQUE KEY uq_categorias_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE productos (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    categoria_id  INT NULL,
    nombre        VARCHAR(150) NOT NULL,
    descripcion   TEXT,
    precio        DECIMAL(10,2) NOT NULL CHECK (precio >= 0),
    disponible    BOOLEAN NOT NULL DEFAULT TRUE,
    imagen_url    TEXT,
    creado_en     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_productos_categoria FOREIGN KEY (categoria_id)
        REFERENCES categorias_productos(id) ON DELETE SET NULL,
    INDEX idx_productos_categoria (categoria_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- 4. PEDIDOS
--    No se lleva tabla de mesas: "notas" es un campo libre
--    donde el mesero indica a qué mesa va dirigido el pedido,
--    y tanto mesero como cliente pueden dejar observaciones
--    generales para cocina.
-- ---------------------------------------------------------
CREATE TABLE pedidos (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    cliente_id      BIGINT NOT NULL,
    mesero_id       CHAR(36) NULL,
    tipo_pedido     ENUM('mesa', 'domicilio', 'recoger') NOT NULL DEFAULT 'mesa',
    notas           TEXT,
    estado          ENUM('pendiente', 'aceptado', 'rechazado', 'en_preparacion',
                          'listo', 'entregado', 'cancelado') NOT NULL DEFAULT 'pendiente',
    motivo_rechazo  TEXT,
    total           DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    creado_en       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pedidos_cliente FOREIGN KEY (cliente_id)
        REFERENCES clientes(id) ON DELETE RESTRICT,
    CONSTRAINT fk_pedidos_mesero FOREIGN KEY (mesero_id)
        REFERENCES usuarios(id) ON DELETE SET NULL,
    INDEX idx_pedidos_estado (estado),
    INDEX idx_pedidos_creado_en (creado_en),
    INDEX idx_pedidos_cliente (cliente_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- 5. DETALLE DE PEDIDO (N:M pedidos <-> productos)
--    "observaciones" es a nivel de ítem (ej. "sin cebolla"),
--    distinto de "notas" en pedidos (a nivel de todo el pedido).
-- ---------------------------------------------------------
CREATE TABLE detalle_pedido (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    pedido_id        BIGINT NOT NULL,
    producto_id      INT NOT NULL,
    cantidad         INT NOT NULL CHECK (cantidad > 0),
    precio_unitario  DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
    observaciones    TEXT,
    subtotal         DECIMAL(10,2) GENERATED ALWAYS AS (cantidad * precio_unitario) STORED,
    CONSTRAINT fk_detalle_pedido FOREIGN KEY (pedido_id)
        REFERENCES pedidos(id) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_producto FOREIGN KEY (producto_id)
        REFERENCES productos(id) ON DELETE RESTRICT,
    INDEX idx_detalle_pedido (pedido_id),
    INDEX idx_detalle_producto (producto_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- 6. HISTORIAL DE ESTADOS (auditoría para estadísticas)
-- ---------------------------------------------------------
CREATE TABLE historial_estados_pedido (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    pedido_id   BIGINT NOT NULL,
    estado      ENUM('pendiente', 'aceptado', 'rechazado', 'en_preparacion',
                      'listo', 'entregado', 'cancelado') NOT NULL,
    usuario_id  CHAR(36) NULL,
    comentario  TEXT,
    fecha_hora  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_historial_pedido FOREIGN KEY (pedido_id)
        REFERENCES pedidos(id) ON DELETE CASCADE,
    CONSTRAINT fk_historial_usuario FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id) ON DELETE SET NULL,
    INDEX idx_historial_pedido (pedido_id, fecha_hora),
    INDEX idx_historial_estado_fecha (estado, fecha_hora)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- =========================================================
-- 7. TRIGGERS DE AUTOMATIZACIÓN
-- =========================================================

DELIMITER $$

-- 7.1 Registrar en el historial cuando se crea un pedido
CREATE TRIGGER trg_pedidos_historial_insert
AFTER INSERT ON pedidos
FOR EACH ROW
BEGIN
    INSERT INTO historial_estados_pedido (pedido_id, estado, fecha_hora)
    VALUES (NEW.id, NEW.estado, NOW());
END$$

-- 7.2 Registrar en el historial cada cambio de estado
CREATE TRIGGER trg_pedidos_historial_update
AFTER UPDATE ON pedidos
FOR EACH ROW
BEGIN
    IF NEW.estado <> OLD.estado THEN
        INSERT INTO historial_estados_pedido (pedido_id, estado, fecha_hora)
        VALUES (NEW.id, NEW.estado, NOW());
    END IF;
END$$

-- 7.3 Recalcular total del pedido al insertar un ítem
CREATE TRIGGER trg_detalle_recalc_total_insert
AFTER INSERT ON detalle_pedido
FOR EACH ROW
BEGIN
    UPDATE pedidos
    SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_pedido WHERE pedido_id = NEW.pedido_id)
    WHERE id = NEW.pedido_id;
END$$

-- 7.4 Recalcular total del pedido al modificar un ítem
CREATE TRIGGER trg_detalle_recalc_total_update
AFTER UPDATE ON detalle_pedido
FOR EACH ROW
BEGIN
    UPDATE pedidos
    SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_pedido WHERE pedido_id = NEW.pedido_id)
    WHERE id = NEW.pedido_id;
END$$

-- 7.5 Recalcular total del pedido al eliminar un ítem
CREATE TRIGGER trg_detalle_recalc_total_delete
AFTER DELETE ON detalle_pedido
FOR EACH ROW
BEGIN
    UPDATE pedidos
    SET total = (SELECT COALESCE(SUM(subtotal), 0) FROM detalle_pedido WHERE pedido_id = OLD.pedido_id)
    WHERE id = OLD.pedido_id;
END$$

DELIMITER ;