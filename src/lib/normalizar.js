/** Deja solo digitos: "1.234.567", " 1234567", "1234567-0" -> "1234567" */
function normalizarCedula(valor) {
  return String(valor ?? '').replace(/\D/g, '').trim();
}

/** Construye la clave unica de mesa: local + mesa (el numero de mesa se repite entre locales). */
function claveMesa(local, mesa) {
  return `${String(local ?? '').trim().toUpperCase()}__${mesa}`;
}

module.exports = { normalizarCedula, claveMesa };
