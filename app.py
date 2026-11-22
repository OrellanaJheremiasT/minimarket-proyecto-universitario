import os
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

import pyodbc
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

STOCK_BAJO = 5
MAX_INT = 2_147_483_647
CATALOGOS = {
    "categorias": ("Categoria", "id_categoria", ("nombre", "descripcion")),
    "proveedores": ("Proveedor", "id_proveedor", ("nombre", "telefono", "direccion")),
    "clientes": ("Cliente", "id_cliente", ("nombre", "telefono")),
}


class DatosInvalidos(ValueError):
    pass


class Conflicto(ValueError):
    pass


class NoEncontrado(ValueError):
    pass


class ConexionNoConfigurada(RuntimeError):
    pass


@contextmanager
def cursor(*, escritura=False):
    cadena = os.getenv("DB_CONNECTION_STRING")
    if not cadena:
        raise ConexionNoConfigurada("Falta DB_CONNECTION_STRING en .env")
    conexion = pyodbc.connect(cadena, timeout=5, autocommit=not escritura)
    try:
        yield conexion.cursor()
        if escritura:
            conexion.commit()
    except Exception:
        if escritura:
            conexion.rollback()
        raise
    finally:
        conexion.close()


def filas(cur):
    # Flask convierte Decimal en texto para conservar la precisión del precio.
    columnas = [columna[0] for columna in cur.description]
    return [dict(zip(columnas, fila)) for fila in cur.fetchall()]


def datos_json():
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict):
        raise DatosInvalidos("Envía un objeto JSON válido.")
    return datos


def texto(valor, etiqueta, limite, obligatorio=False):
    if valor is None:
        valor = ""
    if not isinstance(valor, str):
        raise DatosInvalidos(f"{etiqueta} debe ser texto.")
    valor = valor.strip()
    if obligatorio and not valor:
        raise DatosInvalidos(f"{etiqueta} es un campo obligatorio.")
    try:
        longitud = len(valor.encode("utf-16-le")) // 2
    except UnicodeEncodeError as error:
        raise DatosInvalidos(f"{etiqueta} contiene caracteres inválidos.") from error
    if longitud > limite:
        raise DatosInvalidos(f"{etiqueta} admite hasta {limite} caracteres.")
    return valor or None


def entero(valor, etiqueta, minimo=1):
    valor = str(valor)
    if not valor.isascii() or not valor.isdecimal() or len(valor) > 10:
        raise DatosInvalidos(f"{etiqueta} debe ser un número entero válido.")
    resultado = int(valor)
    if not minimo <= resultado <= MAX_INT:
        raise DatosInvalidos(f"{etiqueta} está fuera del rango permitido.")
    return resultado


def precio(valor):
    try:
        resultado = Decimal(str(valor))
    except InvalidOperation as error:
        raise DatosInvalidos("Ingresa un precio válido.") from error
    if (
        not resultado.is_finite()
        or not Decimal("0") < resultado < Decimal("10000000000")
        or resultado.as_tuple().exponent < -2
    ):
        raise DatosInvalidos("Ingresa un precio positivo con hasta dos decimales.")
    return resultado


def fecha_filtro(campo):
    valor = request.args.get(campo)
    if not valor:
        return None
    try:
        resultado = date.fromisoformat(valor)
        if resultado.isoformat() != valor or resultado == date.max:
            raise ValueError
        return resultado
    except ValueError as error:
        raise DatosInvalidos(f"Ingresa una fecha válida para «{campo}».") from error


@app.errorhandler(DatosInvalidos)
def error_datos(error):
    return jsonify(error=str(error)), 400


@app.errorhandler(Conflicto)
def error_conflicto(error):
    return jsonify(error=str(error)), 409


@app.errorhandler(NoEncontrado)
def error_no_encontrado(error):
    return jsonify(error=str(error)), 404


@app.errorhandler(413)
def error_tamano(_):
    return jsonify(error="La solicitud supera el tamaño permitido."), 413


@app.errorhandler(pyodbc.Error)
@app.errorhandler(ConexionNoConfigurada)
def error_base_datos(error):
    estado = str(error.args[0]) if isinstance(error, pyodbc.Error) and error.args else ""
    if estado == "23000":
        return jsonify(error="La operación incumple una restricción de SQL Server. Revisa los datos y sus relaciones."), 409
    if estado == "40001":
        return jsonify(error="Otra operación estaba usando los mismos datos. Vuelve a intentarlo."), 409
    app.logger.warning("Error de SQL Server (%s)", estado or type(error).__name__)
    return jsonify(error="SQL Server no está disponible para esta operación. Revisa la conexión y ejecuta los scripts del README."), 503


@app.get("/")
def inicio():
    return render_template("index.html", stock_bajo=STOCK_BAJO)


@app.route("/api/<tipo>", methods=["GET", "POST"])
def catalogo(tipo):
    if tipo not in CATALOGOS:
        raise NoEncontrado("Catálogo desconocido.")
    # Solo se interpolan identificadores internos, nunca valores de la solicitud.
    tabla, clave, campos = CATALOGOS[tipo]
    if request.method == "GET":
        with cursor() as cur:
            cur.execute(f"SELECT {clave}, {', '.join(campos)} FROM dbo.{tabla} ORDER BY nombre, {clave}")
            return jsonify(filas(cur))

    datos = datos_json()
    longitudes = {"nombre": 100, "descripcion": 255, "telefono": 30, "direccion": 255}
    valores = [texto(datos.get(campo), campo.capitalize(), longitudes[campo], campo == "nombre") for campo in campos]
    marcas = ", ".join("?" for _ in campos)
    with cursor(escritura=True) as cur:
        nuevo_id = cur.execute(
            f"INSERT dbo.{tabla} ({', '.join(campos)}) OUTPUT INSERTED.{clave} VALUES ({marcas})",
            valores,
        ).fetchone()[0]
    return jsonify(id=nuevo_id), 201


@app.get("/api/productos")
def listar_productos():
    busqueda = texto(request.args.get("q"), "Búsqueda", 100)
    categoria = request.args.get("categoria")
    nivel = request.args.get("nivel", "")
    condiciones, valores = [], []
    if busqueda:
        condiciones.append("CHARINDEX(?, nombre) > 0")
        valores.append(busqueda)
    if categoria:
        condiciones.append("id_categoria = ?")
        valores.append(entero(categoria, "Categoría"))
    if nivel == "bajo":
        condiciones.append("stock BETWEEN 1 AND ?")
        valores.append(STOCK_BAJO)
    elif nivel == "agotado":
        condiciones.append("stock = 0")
    elif nivel:
        raise DatosInvalidos("El filtro de stock no es válido.")
    consulta = "SELECT * FROM dbo.v_Inventario"
    if condiciones:
        consulta += " WHERE " + " AND ".join(condiciones)
    with cursor() as cur:
        cur.execute(consulta + " ORDER BY nombre, id_producto", valores)
        return jsonify(filas(cur))


@app.post("/api/productos")
@app.put("/api/productos/<int:producto_id>")
def guardar_producto(producto_id=None):
    datos = datos_json()
    valores = (
        texto(datos.get("nombre"), "Nombre", 100, True),
        entero(datos.get("id_categoria"), "Categoría"),
        entero(datos.get("id_proveedor"), "Proveedor"),
        precio(datos.get("precio")),
    )
    if producto_id is not None:
        producto_id = entero(producto_id, "Producto")
        # El stock es de solo lectura en edición. Así un formulario abierto
        # nunca sobrescribe el descuento de una venta hecha en otra pestaña.
        with cursor(escritura=True) as cur:
            encontrado = cur.execute(
                """
                UPDATE dbo.Producto
                SET nombre=?, id_categoria=?, id_proveedor=?, precio=?
                OUTPUT INSERTED.id_producto WHERE id_producto=?
                """,
                *valores, producto_id,
            ).fetchone()
            if not encontrado:
                raise NoEncontrado("El producto ya no existe.")
        return jsonify(id=producto_id)

    stock = entero(datos.get("stock"), "Stock inicial", 0)
    with cursor(escritura=True) as cur:
        nuevo_id = cur.execute(
            """
            INSERT dbo.Producto (nombre, id_categoria, id_proveedor, precio, stock)
            OUTPUT INSERTED.id_producto VALUES (?, ?, ?, ?, ?)
            """,
            *valores, stock,
        ).fetchone()[0]
    return jsonify(id=nuevo_id), 201


@app.get("/api/resumen")
def resumen():
    with cursor() as cur:
        cur.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM dbo.Producto) AS productos,
                (SELECT COUNT(*) FROM dbo.Producto WHERE stock <= ?) AS alertas,
                (SELECT COUNT(*) FROM dbo.Venta
                    WHERE fecha >= CONVERT(date, SYSDATETIME())
                    AND fecha < DATEADD(day, 1, CONVERT(date, SYSDATETIME()))) AS ventas_hoy,
                (SELECT COALESCE(SUM(total), 0) FROM dbo.Venta
                    WHERE fecha >= CONVERT(date, SYSDATETIME())
                    AND fecha < DATEADD(day, 1, CONVERT(date, SYSDATETIME()))) AS ingresos_hoy
            """,
            STOCK_BAJO,
        )
        indicadores = filas(cur)[0]
        cur.execute(
            """
            WITH dias AS (
                SELECT DATEADD(day, -n, CONVERT(date, SYSDATETIME())) AS dia
                FROM (VALUES (0), (1), (2), (3), (4), (5), (6)) AS x(n)
            )
            SELECT dias.dia, COUNT(v.id_venta) AS ventas, COALESCE(SUM(v.total), 0) AS importe
            FROM dias LEFT JOIN dbo.Venta v
                ON v.fecha >= dias.dia AND v.fecha < DATEADD(day, 1, dias.dia)
            GROUP BY dias.dia ORDER BY dias.dia
            """
        )
        serie = filas(cur)
        cur.execute("SELECT TOP (5) * FROM dbo.v_Inventario WHERE stock <= ? ORDER BY stock, nombre, id_producto", STOCK_BAJO)
        alertas = filas(cur)
    for punto in serie:
        punto["dia"] = punto["dia"].isoformat()
    return jsonify(indicadores=indicadores, serie=serie, alertas=alertas)


@app.get("/api/ventas")
def listar_ventas():
    desde, hasta = fecha_filtro("desde"), fecha_filtro("hasta")
    if desde and hasta and desde > hasta:
        raise DatosInvalidos("La fecha inicial debe ser anterior o igual a la final.")
    condiciones, valores = [], []
    if desde:
        condiciones.append("fecha >= ?")
        valores.append(desde)
    if hasta:
        condiciones.append("fecha < ?")
        valores.append(hasta + timedelta(days=1))
    consulta = "SELECT * FROM dbo.v_HistorialVentas"
    if condiciones:
        consulta += " WHERE " + " AND ".join(condiciones)
    with cursor() as cur:
        cur.execute(consulta + " ORDER BY fecha DESC, id_venta DESC", valores)
        ventas = filas(cur)
    for venta in ventas:
        venta["fecha"] = venta["fecha"].isoformat(timespec="seconds")
    return jsonify(ventas)


@app.post("/api/ventas")
def registrar_venta():
    datos = datos_json()
    cliente = entero(datos.get("id_cliente"), "Cliente")
    items = datos.get("items")
    if not isinstance(items, list) or not items or len(items) > 100:
        raise DatosInvalidos("Incluye entre 1 y 100 líneas de productos.")
    cantidades = {}
    for item in items:
        if not isinstance(item, dict):
            raise DatosInvalidos("Una línea de la venta tiene un formato incorrecto.")
        producto = entero(item.get("id_producto"), "Producto")
        cantidad = entero(item.get("cantidad"), "Cantidad")
        cantidades[producto] = cantidades.get(producto, 0) + cantidad
        if cantidades[producto] > MAX_INT:
            raise DatosInvalidos("La cantidad acumulada supera el máximo permitido.")

    with cursor(escritura=True) as cur:
        if not cur.execute("SELECT id_cliente FROM dbo.Cliente WHERE id_cliente=?", cliente).fetchone():
            raise Conflicto("El cliente seleccionado no existe.")

        detalle, total = [], Decimal("0.00")
        # Se bloquean los productos en un orden común hasta confirmar o revertir.
        for producto, cantidad in sorted(cantidades.items()):
            fila = cur.execute(
                "SELECT nombre, precio, stock FROM dbo.Producto WITH (UPDLOCK, HOLDLOCK) WHERE id_producto=?",
                producto,
            ).fetchone()
            if not fila:
                raise Conflicto("Uno de los productos de la venta ya no existe.")
            if fila.stock < cantidad:
                raise Conflicto(f"Stock insuficiente para {fila.nombre}. Disponible: {fila.stock}.")
            total += fila.precio * cantidad
            detalle.append((producto, cantidad, fila.precio))

        if total >= Decimal("1000000000000"):
            raise DatosInvalidos("El total supera el máximo permitido.")
        venta_id = cur.execute(
            "INSERT dbo.Venta (id_cliente, total) OUTPUT INSERTED.id_venta VALUES (?, ?)",
            cliente, total,
        ).fetchone()[0]
        for producto, cantidad, unitario in detalle:
            cur.execute(
                "INSERT dbo.Detalle_Venta (id_venta, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)",
                venta_id, producto, cantidad, unitario,
            )
            cur.execute("UPDATE dbo.Producto SET stock=stock-? WHERE id_producto=?", cantidad, producto)

    return jsonify(id_venta=venta_id, total=total), 201


@app.get("/api/ventas/<int:venta_id>/detalle")
def detalle_venta(venta_id):
    venta_id = entero(venta_id, "Venta")
    with cursor() as cur:
        cur.execute("SELECT * FROM dbo.v_HistorialVentas WHERE id_venta=?", venta_id)
        resultados = filas(cur)
        if not resultados:
            raise NoEncontrado("La venta no existe.")
        cur.execute(
            """
            SELECT p.nombre, d.cantidad, d.precio_unitario, d.cantidad * d.precio_unitario AS subtotal
            FROM dbo.Detalle_Venta d JOIN dbo.Producto p ON p.id_producto = d.id_producto
            WHERE d.id_venta=? ORDER BY d.id_detalle
            """,
            venta_id,
        )
        detalles = filas(cur)
    venta = resultados[0]
    venta["fecha"] = venta["fecha"].isoformat(timespec="seconds")
    return jsonify(venta=venta, detalles=detalles)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("APP_PORT", "5000")))
