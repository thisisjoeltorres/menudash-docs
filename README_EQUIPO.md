# Doña Burger: guía de integración

La guía completa de onboarding, arquitectura y tareas también está disponible en [docs/Guia_equipo_MenuDash.docx](docs/Guia_equipo_MenuDash.docx).

## Requisitos

- JDK 17 (Maven ya se descarga automáticamente mediante el wrapper del proyecto)
- PostgreSQL 14 o superior
- Navegador moderno y (opcionalmente) Live Server

### Instalar Java en Windows

Descarga **Eclipse Temurin JDK 17 para Windows x64 (.msi)** desde [Adoptium](https://adoptium.net/temurin/releases/?os=windows&arch=x64&package=jdk&version=17). En el instalador deja activadas las opciones para agregar Java al `PATH` y definir `JAVA_HOME`. Luego cierra y abre PowerShell de nuevo y confirma la instalación con `java -version` y `javac -version`. Usa JDK 17 para este proyecto.

## Preparar PostgreSQL

Desde `psql` como usuario administrador ejecuta `CREATE DATABASE donaburger_db;`. Luego, desde la raíz del repositorio:

```powershell
psql -U postgres -d donaburger_db -f database/database.sql
psql -U postgres -d donaburger_db -f database/data.sql
```

La conexión por defecto usa `localhost:5432`, usuario `postgres` y la contraseña configurada como valor predeterminado en `backend/src/main/resources/application.properties`. Si tu instalación local usa otras credenciales, define `DB_USER` y `DB_PASSWORD` antes de arrancar Spring Boot.

Usuarios demo: mostrador/1234, cocina/1234 y admin/9999.

## Ejecutar el backend

Desde una ventana nueva de PowerShell:

```powershell
cd C:\projects\menudash-docs\backend
.\mvnw.cmd -v
.\mvnw.cmd spring-boot:run
```

La primera ejecución descarga Maven 3.9.16; no necesitas instalar `mvn` globalmente. Requiere conexión a Internet esa primera vez. La API queda en `http://localhost:8080/api`.

## Abrir el frontend

Mantén el backend ejecutándose. Abre `frontend/login.html` directamente en el navegador o sirve la carpeta `frontend` con Live Server. El frontend consulta la API cada 3.5 segundos.

## Tareas para repartir

### 1. Estadísticas del día

- Archivos: `backend/src/main/java/app/donaburger/Api.java`, `frontend/scripts.js`.
- Implementar `GET /api/admin/estadisticas`, solo para admin. Calcular ventas y cantidad de pedidos entregados hoy, promedio de ticket y producto más vendido. Retornar `{ "ventas": 0, "entregados": 0, "promedio": 0, "masVendido": "—" }`.
- Conectar el endpoint con las tres tarjetas KPI que hoy muestran datos provisionales.
- Probar con pedidos entregados, cancelados y del día anterior; estos últimos no deben sumarse.

### 2. Historial con filtros de fecha

- Archivos: `frontend/admin.html`, `frontend/scripts.js`, `backend/src/main/java/app/donaburger/Api.java`.
- Agregar fecha inicial/final y permitir combinar fechas, estado, cliente y turno. Enviar parámetros al endpoint de pedidos o extenderlo con filtros validados.
- Probar varios estados y confirmar que los filtros actualicen la tabla sin recargar.

### 3. Stock y disponibilidad

- Archivos: `database/database.sql`, `database/data.sql`, `backend/src/main/java/app/donaburger/Models.java`, `backend/src/main/java/app/donaburger/Api.java`, `frontend/scripts.js`.
- Agregar stock/disponibilidad al menú, validar y descontar cantidades dentro de la transacción de creación del pedido. Rechazar pedidos que superen existencias y ocultar o marcar productos agotados.
- Probar compra válida, cantidad superior al stock y dos compras concurrentes.

### 4. Token de sesión y cierre seguro

- Archivos: `backend/src/main/java/app/donaburger/Api.java`, `frontend/scripts.js`.
- Reemplazar la cabecera de rol de demostración por un token de sesión validable por el backend, agregar expiración y enlazar Salir para limpiar `sessionStorage`.
- Probar token ausente, inválido/expirado y acceso administrativo desde otros roles.

## Límites del prototipo

PIN y rol son demostrativos para entorno local. La base conserva datos y relaciones; turnos, totales y transiciones viven en Java. No hay triggers, funciones almacenadas ni RLS.

## Actualización de esquema: Stock en `menu` (MDS-004)

- **Base nueva (recomendado en desarrollo):** recrear `donaburger_db` y ejecutar `database/database.sql` seguido de `database/data.sql`.
- **Base ya existente:** ejecutar en `psql` o pgAdmin conectado a `donaburger_db`:

```sql
ALTER TABLE menu
  ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0);

UPDATE menu SET stock = 20 WHERE stock = 0 AND eliminado = FALSE;
```
