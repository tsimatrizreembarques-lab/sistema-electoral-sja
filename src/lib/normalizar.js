/**
 * Deja solo digitos: "1.234.567", " 1234567" -> "1234567".
 * Excepcion: si termina en UNA letra se conserva en mayuscula, porque es otra
 * cedula (numero repetido): "1129164B", "1.129.164 b" -> "1129164B".
 */
function normalizarCedula(valor) {
  const texto = String(valor ?? '').trim();
  const digitos = texto.replace(/\D/g, '');
  const letra = texto.match(/\d[\s.-]*([A-Za-z])$/);
  return digitos && letra ? digitos + letra[1].toUpperCase() : digitos;
}

/** Construye la clave unica de mesa: local + mesa (el numero de mesa se repite entre locales). */
function claveMesa(local, mesa) {
  return `${String(local ?? '').trim().toUpperCase()}__${mesa}`;
}

module.exports = { normalizarCedula, claveMesa };
