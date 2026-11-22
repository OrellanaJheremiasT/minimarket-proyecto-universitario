USE master;
GO
IF DB_ID(N'MinimarketDB') IS NULL
    CREATE DATABASE MinimarketDB;
GO
USE MinimarketDB;
GO

IF OBJECT_ID(N'dbo.Categoria', 'U') IS NULL
    CREATE TABLE dbo.Categoria (
        id_categoria INT IDENTITY(1,1) CONSTRAINT PK_Categoria PRIMARY KEY,
        nombre NVARCHAR(100) NOT NULL,
        descripcion NVARCHAR(255) NULL
    );

IF OBJECT_ID(N'dbo.Proveedor', 'U') IS NULL
    CREATE TABLE dbo.Proveedor (
        id_proveedor INT IDENTITY(1,1) CONSTRAINT PK_Proveedor PRIMARY KEY,
        nombre NVARCHAR(100) NOT NULL,
        telefono NVARCHAR(30) NULL,
        direccion NVARCHAR(255) NULL
    );

IF OBJECT_ID(N'dbo.Cliente', 'U') IS NULL
    CREATE TABLE dbo.Cliente (
        id_cliente INT IDENTITY(1,1) CONSTRAINT PK_Cliente PRIMARY KEY,
        nombre NVARCHAR(100) NOT NULL,
        telefono NVARCHAR(30) NULL
    );

IF OBJECT_ID(N'dbo.Producto', 'U') IS NULL
    CREATE TABLE dbo.Producto (
        id_producto INT IDENTITY(1,1) CONSTRAINT PK_Producto PRIMARY KEY,
        id_categoria INT NOT NULL CONSTRAINT FK_Producto_Categoria REFERENCES dbo.Categoria(id_categoria),
        id_proveedor INT NOT NULL CONSTRAINT FK_Producto_Proveedor REFERENCES dbo.Proveedor(id_proveedor),
        nombre NVARCHAR(100) NOT NULL,
        precio DECIMAL(12,2) NOT NULL CONSTRAINT CK_Producto_Precio CHECK (precio > 0),
        stock INT NOT NULL CONSTRAINT CK_Producto_Stock CHECK (stock >= 0)
    );

IF OBJECT_ID(N'dbo.Venta', 'U') IS NULL
    CREATE TABLE dbo.Venta (
        id_venta INT IDENTITY(1,1) CONSTRAINT PK_Venta PRIMARY KEY,
        id_cliente INT NOT NULL CONSTRAINT FK_Venta_Cliente REFERENCES dbo.Cliente(id_cliente),
        fecha DATETIME2 NOT NULL CONSTRAINT DF_Venta_Fecha DEFAULT SYSDATETIME(),
        total DECIMAL(14,2) NOT NULL CONSTRAINT CK_Venta_Total CHECK (total >= 0)
    );

IF OBJECT_ID(N'dbo.Detalle_Venta', 'U') IS NULL
    CREATE TABLE dbo.Detalle_Venta (
        id_detalle INT IDENTITY(1,1) CONSTRAINT PK_Detalle_Venta PRIMARY KEY,
        id_venta INT NOT NULL CONSTRAINT FK_Detalle_Venta_Venta REFERENCES dbo.Venta(id_venta),
        id_producto INT NOT NULL CONSTRAINT FK_Detalle_Venta_Producto REFERENCES dbo.Producto(id_producto),
        cantidad INT NOT NULL CONSTRAINT CK_Detalle_Venta_Cantidad CHECK (cantidad > 0),
        precio_unitario DECIMAL(12,2) NOT NULL CONSTRAINT CK_Detalle_Venta_Precio CHECK (precio_unitario > 0)
    );
GO
