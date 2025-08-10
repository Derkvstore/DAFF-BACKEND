const bcrypt = require('bcrypt');

bcrypt.hash('blopa7267', 10).then(hash => {
  console.log('Hash généré :', hash);
});
