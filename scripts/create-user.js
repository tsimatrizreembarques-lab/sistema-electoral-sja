// Uso:
//   node scripts/create-user.js comando comando-esc49 "clave123" "ESC.NRO.49"
//   node scripts/create-user.js mesa mesa-esc49-12 "clave123" "ESC.NRO.49" 12
//   node scripts/create-user.js concejal concejal-carlos "clave123" "" "" "CARLOS CESAR VELAZQUEZ APURIL"
//   node scripts/create-user.js admin admin "clave123"

require('dotenv').config();
const { getFirestore } = require('../src/lib/firestore');
const { hashPassword } = require('../src/lib/auth');

async function main() {
  const [, , rol, usuario, password, local, mesa, nombreConcejal] = process.argv;

  if (!rol || !usuario || !password) {
    console.error('Uso: node scripts/create-user.js <rol> <usuario> <password> [local] [mesa] [nombreConcejal]');
    console.error('Roles validos: comando | mesa | concejal | admin');
    process.exit(1);
  }

  if (!['comando', 'mesa', 'concejal', 'admin'].includes(rol)) {
    console.error('Rol invalido. Usar: comando | mesa | concejal | admin');
    process.exit(1);
  }

  const db = getFirestore();
  const passwordHash = await hashPassword(password);

  const data = {
    rol,
    passwordHash,
    local: local || null,
    mesa: mesa ? Number(mesa) : null,
    nombreConcejal: nombreConcejal || null,
  };

  await db.collection('usuarios').doc(usuario).set(data);
  console.log(`Usuario '${usuario}' (rol: ${rol}) creado correctamente.`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error al crear el usuario:', error);
  process.exit(1);
});
