USE MinimarketDB;
GO
-- 1. JOIN: inventario con su categoría y proveedor.
SELECT TOP (20) nombre AS producto, categoria, proveedor, precio, stock
FROM dbo.v_Inventario
ORDER BY nombre;

-- 2. GROUP BY y LEFT JOIN: cantidad de productos y unidades por categoría.
SELECT c.nombre AS categoria, COUNT(p.id_producto) AS productos,
       COALESCE(SUM(CONVERT(bigint, p.stock)), 0) AS unidades
FROM dbo.Categoria c
LEFT JOIN dbo.Producto p ON p.id_categoria = c.id_categoria
GROUP BY c.id_categoria, c.nombre
ORDER BY unidades DESC;

-- 3. Detalle de la última venta, con precio histórico y subtotal.
SELECT v.id_venta, v.fecha, c.nombre AS cliente, p.nombre AS producto,
       d.cantidad, d.precio_unitario, d.cantidad * d.precio_unitario AS subtotal
FROM dbo.Venta v
JOIN dbo.Cliente c ON c.id_cliente = v.id_cliente
JOIN dbo.Detalle_Venta d ON d.id_venta = v.id_venta
JOIN dbo.Producto p ON p.id_producto = d.id_producto
WHERE v.id_venta = (SELECT MAX(id_venta) FROM dbo.Venta)
ORDER BY d.id_detalle;

-- 4. Conciliación: resultado vacío si todas las ventas tienen detalle
-- y el total registrado coincide con la suma de sus subtotales.
SELECT v.id_venta, v.total, SUM(d.cantidad * d.precio_unitario) AS total_detalle
FROM dbo.Venta v
LEFT JOIN dbo.Detalle_Venta d ON d.id_venta = v.id_venta
GROUP BY v.id_venta, v.total
HAVING COUNT(d.id_detalle) = 0 OR v.total <> SUM(d.cantidad * d.precio_unitario);
GO
