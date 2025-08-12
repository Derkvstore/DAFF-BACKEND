const bcrypt = require('bcrypt');

bcrypt.hash('Daff6888', 10).then(hash => {
  console.log('Hash généré :', hash);
});


// const bcrypt = require('bcrypt');

// bcrypt.hash('Blopa7267', 10).then(hash => {
//   console.log('Hash généré :', hash);
// });


// const bcrypt = require('bcrypt');

// bcrypt.hash('Derkv10', 10).then(hash => {
//   console.log('Hash généré :', hash);
// });
