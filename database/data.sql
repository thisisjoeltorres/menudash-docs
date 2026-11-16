INSERT INTO usuarios (nombre, rol, pin) VALUES
 ('Mostrador', 'mostrador', '1234'), ('Cocina', 'cocina', '1234'), ('Administrador', 'admin', '9999')
ON CONFLICT (rol) DO UPDATE SET nombre=EXCLUDED.nombre, pin=EXCLUDED.pin, activo=TRUE;
INSERT INTO menu (nombre, precio, emo, tipo) VALUES
 ('Hamburguesa clásica',15000,'🍔','hamburguesa'), ('Hamburguesa doble',22000,'🍔','hamburguesa'),
 ('Perro caliente',12000,'🌭','hamburguesa'), ('Salchipapa',14000,'🍟','plato'),
 ('Papas francesas',7000,'🍟','plato'), ('Gaseosa 400 ml',4000,'🥤','bebida'),
 ('Jugo natural',6000,'🧃','bebida'), ('Agua',3000,'💧','bebida')
ON CONFLICT DO NOTHING;
