package app.donaburger;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.LockModeType;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/* Las entidades JPA reflejan las tablas simples de PostgreSQL. */
@Entity
@Table(name = "usuarios")
class Usuario {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public String nombre;
    public String rol;
    public String pin;
    public boolean activo;
}

@Entity
@Table(name = "menu")
class Producto {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public String nombre;
    public Integer precio;
    public String emo;
    public String tipo;
    public boolean eliminado;
    public OffsetDateTime actualizado;
}

@Entity
@Table(name = "pedidos")
class Pedido {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    public Integer turno;
    public String destino;
    public Integer total;
    public String estado;
    public OffsetDateTime creado;
    public OffsetDateTime actualizado;

    // Los productos pertenecen al pedido y se guardan con él.
    @OneToMany(mappedBy = "pedido", cascade = CascadeType.ALL,
            orphanRemoval = true, fetch = FetchType.EAGER)
    public List<ItemPedido> items_pedido = new ArrayList<>();
}

@Entity
@Table(name = "items_pedido")
class ItemPedido {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @JsonIgnore // Evita un ciclo JSON al devolver el pedido junto con sus productos.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pedido_id")
    public Pedido pedido;

    @Column(name = "id_prod")
    public Long idProd;

    public String nombre;
    public Integer precio;
    public Integer cant;

    // PostgreSQL almacena las notas del producto como un arreglo de texto.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]")
    public String[] notas = new String[0];
}

interface UsuarioRepo extends JpaRepository<Usuario, Long> {
    Optional<Usuario> findByRolAndPinAndActivoTrue(String rol, String pin);
}

interface MenuRepo extends JpaRepository<Producto, Long> {
    List<Producto> findByEliminadoFalseOrderByIdAsc();
}

interface PedidoRepo extends JpaRepository<Pedido, Long> {
    List<Pedido> findAllByOrderByCreadoAsc();

    List<Pedido> findByEstadoInOrderByCreadoAsc(Collection<String> estados);

    List<Pedido> findByCreadoGreaterThanEqualOrderByCreadoDesc(OffsetDateTime desde);

    @Query(value = """
            select coalesce(sum(p.total), 0) as ventas, count(*) as entregados
            from pedidos p
            where p.estado = 'entregado'
              and p.creado >= :desde and p.creado < :hasta
            """, nativeQuery = true)
    EstadisticaDiariaProjection resumenEntregados(@Param("desde") OffsetDateTime desde,
                                                   @Param("hasta") OffsetDateTime hasta);

    @Query(value = """
            select i.nombre as nombre, sum(i.cant) as cantidad
            from items_pedido i join pedidos p on p.id = i.pedido_id
            where p.estado = 'entregado'
              and p.creado >= :desde and p.creado < :hasta
            group by i.nombre order by sum(i.cant) desc, i.nombre asc
            """, nativeQuery = true)
    List<ProductoVendidoProjection> productosMasVendidos(@Param("desde") OffsetDateTime desde,
                                                          @Param("hasta") OffsetDateTime hasta);

    // Bloquea la fila del usuario admin semilla mientras Java asigna el turno diario.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select usuario from Usuario usuario where usuario.rol = 'admin'")
    Optional<Usuario> bloquearTurno();

    @Query(value = """
            select coalesce(max(turno), 0)
            from pedidos
            where (creado at time zone 'America/Bogota')::date = :hoy
            """, nativeQuery = true)
    int maxTurnoHoy(@Param("hoy") java.sql.Date hoy);
}

interface EstadisticaDiariaProjection {
    Number getVentas();
    Number getEntregados();
}

interface ProductoVendidoProjection {
    String getNombre();
    Number getCantidad();
}
