USE MinimarketDB;
GO
CREATE OR ALTER VIEW dbo.v_Inventario AS
SELECT p.id_producto, p.nombre, p.id_categoria, c.nombre AS categoria,
       p.id_proveedor, pv.nombre AS proveedor, p.precio, p.stock
FROM dbo.Producto p
JOIN dbo.Categoria c ON c.id_categoria = p.id_categoria
JOIN dbo.Proveedor pv ON pv.id_proveedor = p.id_proveedor;
GO
CREATE OR ALTER VIEW dbo.v_HistorialVentas AS
SELECT v.id_venta, v.id_cliente, c.nombre AS cliente, v.fecha, v.total,
       COUNT(d.id_detalle) AS lineas,
       COALESCE(SUM(CONVERT(bigint, d.cantidad)), 0) AS unidades
FROM dbo.Venta v
JOIN dbo.Cliente c ON c.id_cliente = v.id_cliente
LEFT JOIN dbo.Detalle_Venta d ON d.id_venta = v.id_venta
GROUP BY v.id_venta, v.id_cliente, c.nombre, v.fecha, v.total;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Producto') AND name = 'IX_Producto_Categoria')
    CREATE INDEX IX_Producto_Categoria ON dbo.Producto (id_categoria, nombre);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Venta') AND name = 'IX_Venta_Fecha')
    CREATE INDEX IX_Venta_Fecha ON dbo.Venta (fecha) INCLUDE (id_cliente, total);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Detalle_Venta') AND name = 'IX_Detalle_Venta_IdVenta')
    CREATE INDEX IX_Detalle_Venta_IdVenta ON dbo.Detalle_Venta (id_venta) INCLUDE (id_producto, cantidad, precio_unitario);
GO
