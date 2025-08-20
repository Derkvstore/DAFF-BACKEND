const express = require('express');
const router = express.Router();
const { pool } = require('./db'); // Assurez-vous que le chemin vers votre pool de connexion est correct
const multer = require('multer'); // Pour gérer l'upload de fichiers
const csv = require('csv-parser'); // Pour parser les fichiers CSV
const xlsx = require('xlsx'); // Pour parser les fichiers Excel
const { Readable } = require('stream'); // Pour convertir le buffer en stream

// Configuration de Multer pour l'upload de fichiers
const upload = multer({ storage: multer.memoryStorage() });

// Listes pour la validation côté backend (doivent correspondre au frontend)
const MARQUES = ["iPhone", "Samsung", "iPad", "AirPod", "Google", "APPLE", "MacBook"];
const MODELES = {
  iPhone: [
    "SE 2022","X", "XR", "XS", "XS MAX", "11 SIMPLE", "11 PRO", "11 PRO MAX",
    "12 SIMPLE", "12 MINI", "12 PRO", "12 PRO MAX",
    "13 SIMPLE", "13 MINI", "13 PRO", "13 PRO MAX",
    "14 SIMPLE", "14 PLUS", "14 PRO", "14 PRO MAX",
    "15 SIMPLE", "15 PLUS", "15 PRO", "15 PRO MAX",
    "16 SIMPLE", "16e","16 PLUS", "16 PRO", "16 PRO MAX",
     "17 SIMPLE", "17 AIR", "17 PRO", "17 PRO MAX",
  ],
  Samsung: ["Galaxy S21", "Galaxy S22", "Galaxy A14", "Galaxy Note 20", "Galaxy A54", "Galaxy A36",],
  iPad: ["Air 10éme Gen", "Air 11éme Gen", "Pro", "Mini"],
  AirPod: ["1ère Gen", "2ème Gen", "3ème Gen", "4ème Gen", "Pro 1ème Gen,", "2ème Gen"],
  Google: ["PIXEL 8 PRO"],
  APPLE:["WATCH 09 41mm", "WATCH 10 41mm","WATCH 10 46mm","WATCH 11 41mm","WATCH 10 46mm" ],
  MacBook: ["Air M1 13 2020","Air M1 15 2020","Air M2 13 2020", "Air 15 M2 2020","Air M2 2020","Air M1 2020","Air M1 2020","Air M1 2020","Air M1 2020","Pro", ]
};
const STOCKAGES = ["64 Go", "128 Go", "256 Go", "512 Go", "1 To" ,"2 To", "Slim", "Digital", "Pro", "Standard",];

// Route pour récupérer tous les produits
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
          p.id,
          p.marque,
          p.modele,
          p.stockage,
          p.type,
          p.type_carton,
          p.imei,
          p.quantite,
          p.prix_vente,
          p.prix_achat,
          p.status,
          p.date_ajout,
          p.fournisseur_id,
          f.nom AS nom_fournisseur
      FROM products p
      LEFT JOIN fournisseurs f ON p.fournisseur_id = f.id
      ORDER BY p.date_ajout DESC
    `);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erreur lors de la récupération des produits:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des produits.' });
  }
});

// Route pour récupérer un produit par ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT
          p.id,
          p.marque,
          p.modele,
          p.stockage,
          p.type,
          p.type_carton,
          p.imei,
          p.quantite,
          p.prix_vente,
          p.prix_achat,
          p.status,
          p.date_ajout,
          p.fournisseur_id,
          f.nom AS nom_fournisseur
      FROM products p
      LEFT JOIN fournisseurs f ON p.fournisseur_id = f.id
      WHERE p.id = $1
    `, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé.' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Erreur lors de la récupération du produit par ID:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération du produit.' });
  }
});

// Route pour ajouter plusieurs produits (BATCH INSERT)
router.post('/batch', async (req, res) => {
  const {
    marque, modele, stockage, type, type_carton, imei, // 'imei' est un tableau
    prix_vente, prix_achat, fournisseur_id
  } = req.body;

  // Validation de base pour les champs globaux
  if (!marque || !modele || !type || !prix_vente || !prix_achat || !fournisseur_id || !Array.isArray(imei) || imei.length === 0) {
    return res.status(400).json({ error: 'Tous les champs requis (marque, modèle, type, prix_vente, prix_achat, fournisseur_id) et au moins un IMEI sont nécessaires.' });
  }

  // Si type est 'CARTON' et marque est 'iPhone', alors type_carton est requis
  if (type === 'CARTON' && marque.toLowerCase() === 'iphone' && !type_carton) {
    return res.status(400).json({ error: 'Le type de carton est requis pour les iPhones en carton.' });
  }
  // Si type est 'ARRIVAGE' et marque est 'iPhone', alors type_carton est requis (SM/MSG)
  if (type === 'ARRIVAGE' && marque.toLowerCase() === 'iphone' && !type_carton) {
    return res.status(400).json({ error: 'La qualité d\'arrivage (SM/MSG) est requise pour les iPhones en arrivage.' });
  }


  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // Début de la transaction

    const successProducts = [];
    const failedProducts = [];

    for (const singleImei of imei) {
      // Extraction des 6 derniers chiffres de l'IMEI si la longueur est supérieure à 6
      const processedImei = singleImei && String(singleImei).length > 6 ? String(singleImei).slice(-6) : String(singleImei);

      if (!/^\d{6}$/.test(processedImei)) {
        failedProducts.push({ imei: singleImei, error: 'IMEI doit contenir exactement 6 chiffres après traitement.' });
        continue;
      }

      try {
        const result = await client.query(
          `INSERT INTO products (
              marque, modele, stockage, type, type_carton, imei,
              prix_vente, prix_achat, quantite, date_ajout, status, fournisseur_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'active', $10) RETURNING *`,
          [
            marque, modele, stockage, type, type_carton || null, processedImei, // Utilise processedImei
            prix_vente, prix_achat, 1, fournisseur_id
          ]
        );
        successProducts.push(result.rows[0]);
      } catch (insertError) {
        if (insertError.code === '23505') { // Code d'erreur pour violation de contrainte unique
          failedProducts.push({ imei: singleImei, error: 'IMEI déjà existant pour cette combinaison produit.' });
        } else if (insertError.code === '23514') { // Code d'erreur pour violation de contrainte de vérification (check constraint)
          failedProducts.push({ imei: singleImei, error: `Violation de contrainte de base de données: ${insertError.constraint}` });
        } else if (insertError.code === '23503') { // Code d'erreur pour violation de clé étrangère
          failedProducts.push({ imei: singleImei, error: 'Fournisseur non trouvé.' });
        } else {
          console.error(`Erreur lors de l'insertion de l'IMEI ${singleImei}:`, insertError);
          failedProducts.push({ imei: singleImei, error: `Erreur interne: ${insertError.message}` });
        }
      }
    }

    await client.query('COMMIT'); // Commit si tout s'est bien passé pour les réussites

    if (successProducts.length > 0) {
      if (failedProducts.length === 0) {
        res.status(201).json({ message: 'Tous les produits ont été ajoutés avec succès.', successProducts, successCount: successProducts.length });
      } else {
        res.status(207).json({ // 207 Multi-Status
          message: 'Certains produits ont été ajoutés avec succès, mais d\'autres ont échoué.',
          successProducts,
          failedProducts,
          successCount: successProducts.length
        });
      }
    } else {
      res.status(400).json({ error: 'Aucun produit n\'a pu être ajouté.', failedProducts });
    }

  } catch (transactionError) {
    await client.query('ROLLBACK'); // Rollback en cas d'erreur de transaction
    console.error('Erreur lors de la transaction d\'ajout de produits en lot:', transactionError);
    res.status(500).json({ error: 'Erreur serveur lors de l\'ajout des produits en lot.' });
  } finally {
    client.release();
  }
});


// Route pour importer des produits via CSV/Excel
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier n\'a été téléchargé.' });
  }

  const fileBuffer = req.file.buffer;
  const originalname = req.file.originalname;
  const productsToImport = [];
  const failedProducts = [];
  let rowNumber = 1; // Pour le suivi des lignes dans le fichier (commence à 1 pour les en-têtes)
  let fournisseurs;

  try {
    const fournisseursRes = await pool.query('SELECT id, nom FROM fournisseurs');
    fournisseurs = fournisseursRes.rows;
  } catch (dbError) {
    return res.status(500).json({ error: 'Erreur lors de la récupération des fournisseurs.' });
  }


  try {
    // Déterminer le type de fichier et le parser en conséquence
    if (originalname.endsWith('.csv')) {
      const stream = Readable.from(fileBuffer.toString());
      await new Promise((resolve, reject) => {
        stream.pipe(csv())
          .on('data', (row) => {
            rowNumber++; // Incrémenter pour chaque ligne de données
            productsToImport.push({ ...row, _row: rowNumber });
          })
          .on('end', resolve)
          .on('error', reject);
      });
    } else if (originalname.endsWith('.xlsx')) {
      const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      // sheet_to_json par défaut ignore la première ligne si elle est considérée comme des en-têtes
      const jsonRows = xlsx.utils.sheet_to_json(sheet);

      jsonRows.forEach((row) => {
        rowNumber++; // Incrémenter pour chaque ligne de données (après les en-têtes)
        productsToImport.push({ ...row, _row: rowNumber });
      });
    } else {
      return res.status(400).json({ error: 'Format de fichier non supporté. Veuillez utiliser un fichier CSV ou XLSX.' });
    }

    if (productsToImport.length === 0) {
      return res.status(400).json({ error: 'Le fichier ne contient aucune donnée de produit valide ou les en-têtes sont incorrects.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN'); // Début de la transaction pour l'importation

      let successCount = 0;

      for (const productData of productsToImport) {
        // Normaliser les noms de colonnes pour être insensibles à la casse et aux espaces
        const normalizedProductData = {};
        for (const key in productData) {
            normalizedProductData[key.toLowerCase().trim()] = productData[key];
        }

        const {
          marque, modele, stockage, type, type_carton, imei,
          prix_vente, prix_achat, fournisseur_id, _row
        } = normalizedProductData; // Utiliser les données normalisées

        // Validation et traitement des données de chaque ligne
        let currentError = null;

        // Traitement de l'IMEI: extraction des 6 derniers chiffres
        const processedImei = imei && String(imei).length > 6 ? String(imei).slice(-6) : String(imei);

        // Validation des champs obligatoires
        if (!marque || !modele || !type || !imei || !prix_vente || !prix_achat || !fournisseur_id) {
          currentError = 'Champs obligatoires manquants (marque, modele, type, imei, prix_vente, prix_achat, fournisseur_id).';
        } else if (!/^\d{6}$/.test(processedImei)) {
          currentError = `IMEI '${imei}' invalide (doit contenir exactement 6 chiffres après traitement).`;
        } else if (isNaN(parseFloat(prix_vente)) || isNaN(parseFloat(prix_achat))) {
          currentError = 'Prix de vente ou prix d\'achat invalide (doit être un nombre).';
        } else if (parseFloat(prix_vente) <= parseFloat(prix_achat)) {
          currentError = 'Le prix de vente ne peut pas être inférieur ou égal au prix d\'achat.';
        } else if (!MARQUES.includes(marque)) { // Validation de la marque
            currentError = `Marque '${marque}' non reconnue.`;
        } else if (MODELES[marque] && !MODELES[marque].includes(modele)) { // Validation du modèle
            currentError = `Modèle '${modele}' invalide pour la marque '${marque}'.`;
        } else if (type === 'CARTON' && marque.toLowerCase() === 'iphone' && !['GW', 'ORG', 'ACTIVE', 'NO ACTIVE', 'ESIM ACTIVE', 'ESIM NO ACTIVE'].includes(type_carton)) {
            currentError = 'Qualité de carton invalide pour iPhone CARTON (doit être GW, ORG, ACTIVE, NO ACTIVE, ESIM ACTIVE, ESIM NO ACTIVE).';
        } else if (type === 'ARRIVAGE' && marque.toLowerCase() === 'iphone' && !['SM', 'MSG'].includes(type_carton)) {
            currentError = 'Qualité d\'arrivage invalide pour iPhone ARRIVAGE (doit être SM ou MSG).';
        } else if (type !== 'CARTON' && type !== 'ARRIVAGE') {
            currentError = 'Type de produit invalide (doit être CARTON ou ARRIVAGE).';
        } else if (type !== 'CARTON' && type !== 'ARRIVAGE' && type_carton) { // type_carton doit être null si pas un iPhone CARTON/ARRIVAGE
            currentError = 'Qualité carton/arrivage non applicable pour ce type de produit.';
        } else if (!fournisseurs.some(f => f.id === parseInt(fournisseur_id, 10))) {
            currentError = `Fournisseur ID '${fournisseur_id}' non trouvé.`;
        }

        if (currentError) {
          failedProducts.push({ row: _row, imei: imei, error: currentError });
          continue; // Passer au produit suivant
        }

        try {
          // Tenter l'insertion
          const insertResult = await client.query(
            `INSERT INTO products (
                marque, modele, stockage, type, type_carton, imei,
                prix_vente, prix_achat, quantite, date_ajout, status, fournisseur_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), 'active', $10) RETURNING id`,
            [
              marque, modele, stockage || null, type, type_carton || null, processedImei,
              parseFloat(prix_vente), parseFloat(prix_achat), 1, parseInt(fournisseur_id, 10)
            ]
          );
          successCount++;
        } catch (insertError) {
          if (insertError.code === '23505') {
            failedProducts.push({ row: _row, imei: imei, error: 'IMEI déjà existant pour cette combinaison produit.' });
          } else if (insertError.code === '23514') {
            failedProducts.push({ row: _row, imei: imei, error: `Violation de contrainte de base de données: ${insertError.constraint}` });
          } else {
            console.error(`Erreur DB lors de l'insertion de la ligne ${_row} (IMEI: ${imei}):`, insertError);
            failedProducts.push({ row: _row, imei: imei, error: `Erreur interne: ${insertError.message}` });
          }
        }
      }

      await client.query('COMMIT'); // Commit la transaction si aucune erreur majeure n'a interrompu le processus

      if (successCount > 0) {
        res.status(200).json({
          message: 'Importation terminée.',
          successCount,
          failedProducts
        });
      } else {
        res.status(400).json({
          error: 'Aucun produit n\'a pu être importé.',
          failedProducts
        });
      }

    } catch (transactionError) {
      await client.query('ROLLBACK'); // Rollback en cas d'erreur de transaction
      console.error('Erreur lors de la transaction d\'importation:', transactionError);
      res.status(500).json({ error: 'Erreur serveur lors de l\'importation des produits.' });
    } finally {
      client.release();
    }

  } catch (parseError) {
    console.error('Erreur lors du parsing du fichier:', parseError);
    res.status(400).json({ error: 'Erreur lors de la lecture du fichier. Veuillez vérifier son format.' });
  }
});


// Route pour mettre à jour un produit existant
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    marque, modele, stockage, type, type_carton, imei,
    prix_vente, prix_achat, quantite, fournisseur_id, update_all_same_products = false
  } = req.body;

  // Le statut sera toujours 'active' lors d'une modification pour le remettre en stock
  const status = 'active';

  if (!marque || !modele || !imei || !type || !prix_vente || !prix_achat || !fournisseur_id) {
    return res.status(400).json({ error: 'Tous les champs requis sont nécessaires pour la mise à jour.' });
  }

  // Traitement de l'IMEI: extraction des 6 derniers chiffres si la longueur est supérieure à 6
  const processedImei = imei && String(imei).length > 6 ? String(imei).slice(-6) : String(imei);

  // Validation IMEI pour mise à jour
  if (!/^\d{6}$/.test(processedImei)) {
    return res.status(400).json({ error: 'L\'IMEI doit contenir exactement 6 chiffres après traitement.' });
  }

  // Validation du type_carton si applicable
  if (type === 'CARTON' && marque.toLowerCase() === 'iphone' && !type_carton) {
    return res.status(400).json({ error: 'Le type de carton est requis pour les iPhones en carton.' });
  }
  if (type === 'ARRIVAGE' && marque.toLowerCase() === 'iphone' && !type_carton) {
    return res.status(400).json({ error: 'La qualité d\'arrivage (SM/MSG) est requise pour les iPhones en arrivage.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Début de la transaction
    let result;

    if (update_all_same_products) {
      // Étape 1: Récupérer les informations du produit original pour la correspondance
      const originalProductQuery = `
          SELECT marque, modele, stockage, type, type_carton
          FROM products
          WHERE id = $1
      `;
      const originalProductResult = await client.query(originalProductQuery, [id]);
      if (originalProductResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Produit original non trouvé pour la mise à jour par lot.' });
      }

      const originalProduct = originalProductResult.rows[0];

      // Étape 2: Mettre à jour tous les produits correspondants
      const updateQuery = `
        UPDATE products SET
            prix_vente = $1, prix_achat = $2
        WHERE
            marque = $3 AND modele = $4 AND (stockage = $5 OR (stockage IS NULL AND $5 IS NULL)) AND type = $6 AND (type_carton = $7 OR (type_carton IS NULL AND $7 IS NULL))
        RETURNING *
      `;
      // La quantité, l'IMEI et le fournisseur ne sont pas mis à jour ici
      result = await client.query(updateQuery, [
        prix_vente, prix_achat,
        originalProduct.marque, originalProduct.modele, originalProduct.stockage, originalProduct.type, originalProduct.type_carton
      ]);
    } else {
      // Mise à jour d'un seul produit
      const updateQuery = `
        UPDATE products SET
            marque = $1, modele = $2, stockage = $3, type = $4, type_carton = $5, imei = $6,
            prix_vente = $7, prix_achat = $8, quantite = $9, status = $10, fournisseur_id = $11
         WHERE id = $12 RETURNING *
      `;
      result = await client.query(updateQuery, [
        marque, modele, stockage, type, type_carton || null, processedImei,
        prix_vente, prix_achat, quantite, status, fournisseur_id,
        id
      ]);
    }

    await client.query('COMMIT'); // Confirmer la transaction

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Produit non trouvé.' });
    }

    const message = update_all_same_products
      ? `Les prix de vente et d'achat de ${result.rows.length} produits similaires ont été mis à jour avec succès.`
      : 'Produit mis à jour avec succès.';

    res.status(200).json({ message, updatedProducts: result.rows });

  } catch (error) {
    await client.query('ROLLBACK'); // Annuler la transaction en cas d'erreur
    console.error('Erreur lors de la mise à jour du produit:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Un autre produit avec cette combinaison de clés uniques existe déjà.' });
    } else if (error.code === '23503') {
      return res.status(400).json({ error: 'Fournisseur non trouvé ou invalide.' });
    } else if (error.code === '23514') {
      return res.status(400).json({ error: `Violation de contrainte de base de données: ${error.constraint}` });
    }
    res.status(500).json({ error: 'Erreur serveur lors de la mise à jour du produit.' });
  } finally {
    client.release();
  }
});


// Route pour supprimer un produit
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect(); // Obtenir une connexion pour la transaction
  try {
    await client.query('BEGIN'); // Démarrer la transaction

    // Vérifier si le produit est lié à des ventes
    const salesCheck = await client.query('SELECT 1 FROM vente_items WHERE produit_id = $1 LIMIT 1', [id]);
    if (salesCheck.rows.length > 0) {
      await client.query('ROLLBACK'); // Annuler la transaction
      return res.status(409).json({ error: 'Impossible de supprimer ce produit car il est déjà associé à une ou plusieurs ventes. Veuillez d\'abord supprimer les ventes associées.' });
    }

    // Si aucune vente n'est liée, procéder à la suppression
    const result = await client.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK'); // Annuler la transaction
      return res.status(404).json({ error: 'Produit non trouvé.' });
    }
    await client.query('COMMIT'); // Confirmer la transaction
    res.status(200).json({ message: 'Produit supprimé avec succès.', deletedProduct: result.rows[0] });
  } catch (error) {
    console.error('Erreur lors de la suppression du produit:', error);
    await client.query('ROLLBACK'); // S'assurer que la transaction est annulée en cas d'erreur inattendue
    res.status(500).json({ error: 'Erreur serveur lors de la suppression du produit.' });
  } finally {
    client.release(); // Libérer la connexion
  }
});

module.exports = router;
