USE MinimarketDB;
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Los datos ficticios se instalan solo si los catálogos están vacíos.
IF NOT EXISTS (SELECT 1 FROM dbo.Categoria)
   AND NOT EXISTS (SELECT 1 FROM dbo.Proveedor)
   AND NOT EXISTS (SELECT 1 FROM dbo.Cliente)
   AND NOT EXISTS (SELECT 1 FROM dbo.Producto)
BEGIN
    INSERT dbo.Categoria (nombre, descripcion) VALUES
        (N'Bebidas', N'Agua, refrescos y jugos'),
        (N'Abarrotes', N'Productos secos de uso diario'),
        (N'Lácteos', N'Leche, yogur y derivados'),
        (N'Limpieza', N'Artículos de limpieza del hogar'),
        (N'Snacks', N'Porciones y aperitivos');

    INSERT dbo.Proveedor (nombre, telefono, direccion) VALUES
        (N'Distribuidora Central', N'900000001', N'Av. Principal 120'),
        (N'Suministros del Valle', N'900000002', N'Jr. Los Álamos 80'),
        (N'Comercial San Martín', N'900000003', N'Calle Norte 51');

    INSERT dbo.Cliente (nombre, telefono) VALUES
        (N'Público general', NULL),
        (N'Ana Torres', N'900000011'),
        (N'Mateo Rojas', N'900000012');

    INSERT dbo.Producto (nombre, id_categoria, id_proveedor, precio, stock)
    SELECT x.producto, c.id_categoria, p.id_proveedor, x.precio, x.stock
    FROM (VALUES
        (N'Agua 625 ml',        N'Bebidas',   N'Distribuidora Central',  2.50, 30),
        (N'Jugo de naranja 1 L',N'Bebidas',   N'Distribuidora Central',  7.50, 12),
        (N'Arroz 1 kg',         N'Abarrotes', N'Suministros del Valle',  5.80, 20),
        (N'Fideos 500 g',       N'Abarrotes', N'Suministros del Valle',  4.20, 15),
        (N'Leche 1 L',          N'Lácteos',   N'Distribuidora Central',  6.40, 18),
        (N'Yogur de fresa',     N'Lácteos',   N'Distribuidora Central',  4.80,  3),
        (N'Detergente 800 g',   N'Limpieza',  N'Comercial San Martín',  12.90,  4),
        (N'Jabón líquido',      N'Limpieza',  N'Comercial San Martín',   9.90,  0),
        (N'Galletas de avena',  N'Snacks',    N'Suministros del Valle',  3.20, 25),
        (N'Papas saladas 45 g', N'Snacks',    N'Comercial San Martín',   3.80,  6)
    ) x(producto, categoria, proveedor, precio, stock)
    JOIN dbo.Categoria c ON c.nombre = x.categoria
    JOIN dbo.Proveedor p ON p.nombre = x.proveedor;

    -- Doce ventas previas para mostrar tendencias. Se descuenta el stock
    -- de los ejemplos vendidos y se conserva el Agua 625 ml para la demo.
    DECLARE @hoy DATE = CONVERT(date, SYSDATETIME());
    DECLARE @publico INT = (SELECT id_cliente FROM dbo.Cliente WHERE nombre = N'Público general');
    DECLARE @muestra TABLE (id_venta INT, fecha DATETIME2);
    INSERT dbo.Venta (id_cliente, fecha, total)
    OUTPUT INSERTED.id_venta, INSERTED.fecha INTO @muestra
    SELECT @publico, DATEADD(hour, x.hora, CONVERT(datetime2, DATEADD(day, -x.dias, @hoy))), 0
    FROM (VALUES (6,9),(6,12),(5,10),(4,11),(4,14),(4,16),
                 (2,9),(2,15),(1,11),(1,13),(1,16),(1,18)) x(dias, hora);

    INSERT dbo.Detalle_Venta (id_venta, id_producto, cantidad, precio_unitario)
    SELECT m.id_venta, p.id_producto, x.cantidad, p.precio
    FROM @muestra m
    JOIN (VALUES (N'Arroz 1 kg', 1), (N'Galletas de avena', 1)) x(nombre, cantidad) ON 1 = 1
    JOIN dbo.Producto p ON p.nombre = x.nombre;

    UPDATE v SET total = d.importe
    FROM dbo.Venta v JOIN (
        SELECT d.id_venta, SUM(d.cantidad * d.precio_unitario) AS importe
        FROM dbo.Detalle_Venta d JOIN @muestra m ON m.id_venta = d.id_venta
        GROUP BY d.id_venta
    ) d ON d.id_venta = v.id_venta;

    UPDATE p SET stock = stock - d.unidades
    FROM dbo.Producto p JOIN (
        SELECT d.id_producto, SUM(d.cantidad) AS unidades
        FROM dbo.Detalle_Venta d JOIN @muestra m ON m.id_venta = d.id_venta
        GROUP BY d.id_producto
    ) d ON d.id_producto = p.id_producto;
END
ELSE
    PRINT N'Los catálogos ya tienen datos. Se omitió la carga de ejemplo.';

COMMIT TRANSACTION;
GO
