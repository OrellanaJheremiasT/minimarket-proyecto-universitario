"use strict";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const umbral = Number(document.body.dataset.stockBajo);
const moneda = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const estado = { vista: "", inventario: [], productos: [], carrito: new Map(), editando: null, guardandoVenta: false };
const secciones = {
  resumen: ["Resumen de operaciones", "Consulta el inventario, las alertas y las ventas recientes."],
  productos: ["Inventario", "Consulta existencias y administra los datos de tus productos."],
  venta: ["Nueva venta", "Registra una salida de productos del inventario."],
  historial: ["Historial de ventas", "Busca ventas por fecha y consulta sus detalles."],
  categorias: ["Categorías", "Agrupa los productos en el catálogo."],
  proveedores: ["Proveedores", "Registra a quienes abastecen el minimarket."],
  clientes: ["Clientes", "Registra clientes para asociarlos a sus ventas."]
};
const catalogos = {
  categorias: [["Nombre", "nombre"], ["Descripción", "descripcion"]],
  proveedores: [["Nombre", "nombre"], ["Teléfono", "telefono"], ["Dirección", "direccion"]],
  clientes: [["Nombre", "nombre"], ["Teléfono", "telefono"]]
};

const entidades = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapar = valor => String(valor ?? "—").replace(/[&<>"']/g, c => entidades[c]);
const dinero = valor => moneda.format(Number(valor));
const fechaVisible = valor => valor.replace("T", " ").slice(0, 16);
const datosForm = form => Object.fromEntries(new FormData(form));

function conexion(status, label) {
  $("#db-status").dataset.status = status;
  $("#db-label").textContent = label;
}

function aviso(mensaje, error = false, destino = "#aviso") {
  const el = $(destino);
  el.hidden = !mensaje;
  el.textContent = mensaje;
  el.dataset.type = error ? "error" : "success";
}

async function api(ruta, metodo = "GET", datos) {
  let respuesta;
  try {
    const opciones = { method: metodo };
    if (datos !== undefined) {
      opciones.headers = { "Content-Type": "application/json" };
      opciones.body = JSON.stringify(datos);
    }
    respuesta = await fetch(`/api/${ruta}`, opciones);
  } catch {
    conexion("error", "Aplicación sin conexión");
    throw new Error("La aplicación local no responde. Comprueba que Flask esté iniciado.");
  }
  const resultado = await respuesta.json();
  if (respuesta.status === 503) {
    conexion("error", "Sin conexión con la base");
  }
  if (!respuesta.ok) {
    throw new Error(resultado.error || "La operación no pudo completarse.");
  }
  conexion("online", "Conectado");
  return resultado;
}

function tabla(destino, columnas, filas, vacio) {
  const contenedor = $(destino);
  if (filas.length === 0) {
    contenedor.innerHTML = '<p class="empty"></p>';
    contenedor.firstElementChild.textContent = vacio;
    return;
  }
  const encabezado = columnas.map(([etiqueta, clase = ""]) =>
    `<th scope="col" class="${clase}">${etiqueta}</th>`
  ).join("");
  const cuerpo = filas.map(fila => {
    const celdas = fila.map((valor, i) => {
      const clase = columnas[i][1] ?? "";
      return i === 0
        ? `<th scope="row" class="${clase}">${valor}</th>`
        : `<td class="${clase}">${valor}</td>`;
    }).join("");
    return `<tr>${celdas}</tr>`;
  }).join("");
  contenedor.innerHTML = `<table><thead><tr>${encabezado}</tr></thead><tbody>${cuerpo}</tbody></table>`;
}

function opciones(select, filas, clave, etiqueta, inicial = "Selecciona una opción") {
  const previo = select.value;
  select.replaceChildren(new Option(inicial, ""));
  filas.forEach(fila => select.add(new Option(etiqueta(fila), fila[clave])));
  if (filas.some(fila => String(fila[clave]) === previo)) select.value = previo;
}

function etiquetaStock(stock, unidades = false) {
  if (stock === 0) return '<span class="pill out">Agotado</span>';
  if (stock <= umbral) {
    return `<span class="pill low">${unidades ? `${stock} disp.` : "Stock bajo"}</span>`;
  }
  return '<span class="pill">Disponible</span>';
}

function filtros(form) {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of new FormData(form)) {
    if (valor) parametros.set(clave, valor);
  }
  return parametros.toString();
}

async function resumen() {
  const { indicadores, serie, alertas } = await api("resumen");
  $("#total-productos").textContent = indicadores.productos;
  $("#total-alertas").textContent = indicadores.alertas;
  $("#ventas-hoy").textContent = indicadores.ventas_hoy;
  $("#ingresos-hoy").textContent = dinero(indicadores.ingresos_hoy);

  const maximo = Math.max(1, ...serie.map(punto => punto.ventas));
  $("#grafico").innerHTML = serie.map(({ dia, ventas }) => `
    <div class="chart-day">
      <div class="chart-track">
        <span class="chart-value">${escapar(ventas)}</span>
        <span class="chart-bar" aria-hidden="true" style="--height:${ventas / maximo * 77}%"></span>
      </div>
      <span class="chart-label">${escapar(dia.slice(8))}/${escapar(dia.slice(5, 7))}</span>
    </div>`).join("");

  $("#lista-alertas").innerHTML = alertas.length
    ? alertas.map(p => `<div class="stock-row">
        <span><strong>${escapar(p.nombre)}</strong><small>${escapar(p.categoria)}</small></span>
        ${etiquetaStock(p.stock, true)}
      </div>`).join("")
    : '<p class="empty">Sin alertas de inventario.</p>';
}

async function inventario() {
  const form = $("#filtros-productos");
  const [categorias, productos] = await Promise.all([
    api("categorias"),
    api(`productos?${filtros(form)}`)
  ]);
  opciones(form.elements.categoria, categorias, "id_categoria", c => c.nombre, "Todas");
  estado.inventario = productos;
  $("#recuento-productos").textContent = `${productos.length} productos encontrados`;
  tabla("#lista-productos", [
    ["Producto"], ["Categoría"], ["Proveedor"], ["Precio", "num"], ["Stock", "num"], ["Estado"], ["Acción"]
  ], productos.map(p => [
    escapar(p.nombre), escapar(p.categoria), escapar(p.proveedor), dinero(p.precio),
    escapar(p.stock), etiquetaStock(p.stock),
    `<button class="button button-quiet" type="button" data-editar="${escapar(p.id_producto)}">
      <i class="bi bi-pencil" aria-hidden="true"></i> Editar</button>`
  ]), "No hay productos que coincidan con los filtros.");
}

async function abrirProducto(producto = null) {
  const [categorias, proveedores] = await Promise.all([api("categorias"), api("proveedores")]);
  if (!categorias.length || !proveedores.length) {
    aviso("Registra al menos una categoría y un proveedor antes de crear un producto.", true);
    return;
  }
  if ($("#dialogo-producto").open || estado.vista !== "productos") return;
  estado.editando = producto?.id_producto ?? null;
  const form = $("#form-producto");
  form.reset();
  opciones(form.elements.id_categoria, categorias, "id_categoria", c => c.nombre);
  opciones(form.elements.id_proveedor, proveedores, "id_proveedor", p => p.nombre);
  $("#titulo-producto").textContent = producto ? "Editar producto" : "Nuevo producto";
  $("#campo-stock").hidden = Boolean(producto);
  form.elements.stock.disabled = Boolean(producto);
  if (producto) {
    for (const campo of ["nombre", "id_categoria", "id_proveedor", "precio"]) {
      form.elements[campo].value = producto[campo];
    }
  }
  aviso("", false, "#error-producto");
  $("#dialogo-producto").showModal();
}

function mostrarCarrito() {
  const lineas = [...estado.carrito.values()];
  tabla("#lista-carrito", [["Producto"], ["Cantidad", "num"], ["Subtotal", "num"], ["Acción"]], lineas.map(p => [
    escapar(p.nombre), escapar(p.cantidad), dinero(p.precio * p.cantidad),
    `<button class="button button-quiet" type="button" data-quitar="${escapar(p.id_producto)}" ${estado.guardandoVenta ? "disabled" : ""}>Quitar</button>`
  ]), "Agrega un producto para abrir la venta.");
  const centavos = lineas.reduce((total, p) => total + Math.round(p.precio * 100) * p.cantidad, 0);
  $("#total-carrito").textContent = dinero(centavos / 100);
  $("#confirmar").disabled = !lineas.length || estado.guardandoVenta;
  $("#form-linea button").disabled = estado.guardandoVenta;
}

async function nuevaVenta() {
  const [productos, clientes] = await Promise.all([api("productos"), api("clientes")]);
  const disponibles = productos.filter(p => p.stock > 0);
  estado.productos = productos;
  for (const linea of estado.carrito.values()) {
    const actualizado = productos.find(p => p.id_producto === linea.id_producto);
    if (actualizado) Object.assign(linea, actualizado);
  }
  opciones($("#form-linea").elements.id_producto, disponibles, "id_producto", p =>
    `${p.nombre} · ${dinero(p.precio)} · ${p.stock} disp.`
  );
  opciones($("#form-venta").elements.id_cliente, clientes, "id_cliente", c => c.nombre);
  mostrarCarrito();
}

async function historial() {
  const ventas = await api(`ventas?${filtros($("#filtros-ventas"))}`);
  $("#recuento-ventas").textContent = `${ventas.length} ventas encontradas`;
  tabla("#lista-ventas", [
    ["Venta"], ["Cliente"], ["Fecha"], ["Unidades", "num"], ["Total", "num"], ["Acción"]
  ], ventas.map(v => [
    `#${escapar(v.id_venta)}`, escapar(v.cliente), escapar(fechaVisible(v.fecha)),
    escapar(v.unidades), dinero(v.total),
    `<button class="button button-outline" type="button" data-venta="${escapar(v.id_venta)}">Ver detalle</button>`
  ]), "No hay ventas en el periodo seleccionado.");
}

async function abrirVenta(id) {
  const { venta, detalles } = await api(`ventas/${id}/detalle`);
  if ($("#dialogo-venta").open || estado.vista !== "historial") return;
  $("#titulo-detalle").textContent = `Venta #${venta.id_venta}`;
  $("#datos-detalle").textContent = `${venta.cliente} · ${fechaVisible(venta.fecha)}`;
  $("#total-detalle").textContent = dinero(venta.total);
  tabla("#lineas-detalle", [["Producto"], ["Cantidad", "num"], ["Precio unitario", "num"], ["Subtotal", "num"]],
    detalles.map(d => [escapar(d.nombre), escapar(d.cantidad), dinero(d.precio_unitario), dinero(d.subtotal)]),
    "Esta venta no tiene líneas registradas."
  );
  $("#dialogo-venta").showModal();
}

async function catalogo(tipo) {
  const filas = await api(tipo);
  const campos = catalogos[tipo];
  tabla(`#lista-${tipo}`, campos.map(([nombre]) => [nombre]),
    filas.map(fila => campos.map(([, campo]) => escapar(fila[campo]))),
    "Aún no hay registros.");
}

const cargadores = { resumen, productos: inventario, venta: nuevaVenta, historial };
function cargar(vista = estado.vista) {
  return cargadores[vista] ? cargadores[vista]() : catalogo(vista);
}

async function ejecutar(accion, destino = "#aviso") {
  try {
    await accion();
  } catch (error) {
    aviso(error.message, true, destino);
  }
}

function navegar() {
  const hash = location.hash.slice(1);
  if (hash === "contenido" && estado.vista) return;
  const vista = Object.hasOwn(secciones, hash) ? hash : "resumen";
  estado.vista = vista;
  const [titulo, descripcion] = secciones[vista];
  $("#titulo").textContent = titulo;
  $("#descripcion").textContent = descripcion;
  $("#accion-pagina").hidden = vista !== "resumen";
  $$("[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== vista; });
  $$("[data-view]").forEach(enlace => {
    if (enlace.dataset.view === vista) enlace.setAttribute("aria-current", "page");
    else enlace.removeAttribute("aria-current");
  });
  aviso("");
  ejecutar(() => cargar(vista));
}

$("#actualizar").addEventListener("click", () => {
  aviso("");
  ejecutar(() => cargar());
});
window.addEventListener("hashchange", navegar);

for (const [selector, cargarTabla] of [["#filtros-productos", inventario], ["#filtros-ventas", historial]]) {
  const form = $(selector);
  form.addEventListener("submit", evento => {
    evento.preventDefault();
    aviso("");
    ejecutar(cargarTabla);
  });
  form.addEventListener("reset", () => { setTimeout(() => ejecutar(cargarTabla), 0); });
}

$$("[data-cerrar]").forEach(boton => {
  boton.addEventListener("click", () => boton.closest("dialog").close());
});
$("#nuevo-producto").addEventListener("click", () => ejecutar(() => abrirProducto()));
$("#lista-productos").addEventListener("click", evento => {
  const boton = evento.target.closest("[data-editar]");
  if (!boton) return;
  const producto = estado.inventario.find(p => p.id_producto === Number(boton.dataset.editar));
  if (producto) ejecutar(() => abrirProducto(producto));
});
$("#lista-ventas").addEventListener("click", evento => {
  const boton = evento.target.closest("[data-venta]");
  if (boton) ejecutar(() => abrirVenta(boton.dataset.venta));
});

$("#form-producto").addEventListener("submit", evento => {
  evento.preventDefault();
  const form = evento.currentTarget;
  const boton = form.querySelector('[type="submit"]');
  const id = estado.editando;
  boton.disabled = true;
  aviso("", false, "#error-producto");
  ejecutar(async () => {
    try {
      await api(id ? `productos/${id}` : "productos", id ? "PUT" : "POST", datosForm(form));
      $("#dialogo-producto").close();
      aviso(id ? "Producto actualizado." : "Producto registrado.");
      await ejecutar(inventario);
    } finally {
      boton.disabled = false;
    }
  }, "#error-producto");
});

$$(".catalog-form").forEach(form => {
  form.addEventListener("submit", evento => {
    evento.preventDefault();
    const tipo = form.dataset.catalog;
    const boton = form.querySelector("button");
    boton.disabled = true;
    ejecutar(async () => {
      try {
        await api(tipo, "POST", datosForm(form));
        form.reset();
        aviso("Registro guardado.");
        await catalogo(tipo);
      } finally {
        boton.disabled = false;
      }
    });
  });
});

$("#form-linea").addEventListener("submit", evento => {
  evento.preventDefault();
  const { id_producto, cantidad } = datosForm(evento.currentTarget);
  const producto = estado.productos.find(p => p.id_producto === Number(id_producto));
  if (!producto || estado.guardandoVenta) return;
  const acumulada = (estado.carrito.get(producto.id_producto)?.cantidad || 0) + Number(cantidad);
  if (acumulada > producto.stock) {
    aviso(`Stock insuficiente para ${producto.nombre}. Disponible: ${producto.stock}.`, true);
    return;
  }
  estado.carrito.set(producto.id_producto, { ...producto, cantidad: acumulada });
  aviso("");
  mostrarCarrito();
});

$("#lista-carrito").addEventListener("click", evento => {
  const boton = evento.target.closest("[data-quitar]");
  if (!boton || estado.guardandoVenta) return;
  estado.carrito.delete(Number(boton.dataset.quitar));
  mostrarCarrito();
});

$("#form-venta").addEventListener("submit", evento => {
  evento.preventDefault();
  if (estado.guardandoVenta || !estado.carrito.size) return;
  const form = evento.currentTarget;
  const { id_cliente } = datosForm(form);
  const items = [...estado.carrito.values()].map(({ id_producto, cantidad }) => ({ id_producto, cantidad }));
  estado.guardandoVenta = true;
  mostrarCarrito();
  ejecutar(async () => {
    try {
      const { id_venta, total } = await api("ventas", "POST", { id_cliente, items });
      estado.carrito.clear();
      form.reset();
      aviso(`Venta #${id_venta} registrada por ${dinero(total)}.`);
      await nuevaVenta();
    } finally {
      estado.guardandoVenta = false;
      mostrarCarrito();
    }
  });
});

navegar();
