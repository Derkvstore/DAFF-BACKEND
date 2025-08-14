// backend/reports.js
const express = require('express');
const router = express.Router();
const { pool } = require('./db');

// Route GET pour obtenir le résumé du stock par modèle
router.get('/stock-summary', async (req, res) => {
  try {
    const query = `
      SELECT
          marque,
          modele,
          stockage,
          type,
          type_carton,
          COALESCE(SUM(CASE WHEN status = 'active' THEN quantite ELSE 0 END), 0) AS total_quantite_en_stock
      FROM
          products
      GROUP BY
          marque, modele, stockage, type, type_carton
      ORDER BY
          marque ASC, modele ASC, stockage ASC, type ASC, type_carton ASC;
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erreur lors du chargement du résumé du stock:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération du résumé du stock.' });
  }
});

// NOUVELLE ROUTE: Comparaison du stock journalier
router.get('/daily-stock-comparison', async (req, res) => {
  try {
    const query = `
      WITH current_stock AS (
        -- CTE pour obtenir le stock actuel de chaque produit
        SELECT
          marque, modele, stockage, type, type_carton,
          COALESCE(SUM(CASE WHEN status = 'active' THEN quantite ELSE 0 END), 0) AS stock_aujourdhui
        FROM products
        GROUP BY marque, modele, stockage, type, type_carton
      ),
      daily_movements AS (
        -- CTE pour calculer tous les mouvements d'aujourd'hui pour chaque produit
        SELECT
          p.marque, p.modele, p.stockage, p.type, p.type_carton,
          -- Produits ajoutés aujourd'hui
          COUNT(DISTINCT CASE WHEN p.date_ajout::date = CURRENT_DATE THEN p.id END) AS ajouts_jour,
          -- Produits vendus aujourd'hui
          COALESCE(SUM(CASE WHEN v.date_vente::date = CURRENT_DATE AND vi.statut_vente = 'actif' THEN vi.quantite_vendue ELSE 0 END), 0) AS ventes_jour,
          -- Produits retournés (défectueux) aujourd'hui
          COUNT(DISTINCT CASE WHEN r.return_date::date = CURRENT_DATE THEN r.id END) AS retours_jour,
          -- Produits rendus (remis en stock) aujourd'hui
          COALESCE(SUM(CASE WHEN vi.rendu_date::date = CURRENT_DATE AND vi.statut_vente = 'rendu' THEN vi.quantite_vendue ELSE 0 END), 0) AS rendus_jour
        FROM products p
        LEFT JOIN vente_items vi ON p.id = vi.produit_id
        LEFT JOIN ventes v ON vi.vente_id = v.id
        LEFT JOIN returns r ON p.id = r.product_id
        GROUP BY p.marque, p.modele, p.stockage, p.type, p.type_carton
      )
      -- Requête finale pour joindre le stock et les mouvements
      SELECT
        cs.marque,
        cs.modele,
        cs.stockage,
        cs.type,
        cs.type_carton,
        cs.stock_aujourdhui,
        -- Calcul du stock d'hier : Stock d'aujourd'hui + Ventes - Ajouts + Retours (défectueux) - Rendus (remis en stock)
        (cs.stock_aujourdhui + dm.ventes_jour - dm.ajouts_jour + dm.retours_jour - dm.rendus_jour) AS stock_hier,
        dm.ajouts_jour,
        dm.ventes_jour,
        dm.retours_jour,
        dm.rendus_jour
      FROM current_stock cs
      JOIN daily_movements dm ON
        cs.marque = dm.marque AND
        cs.modele = dm.modele AND
        COALESCE(cs.stockage, '') = COALESCE(dm.stockage, '') AND
        cs.type = dm.type AND
        COALESCE(cs.type_carton, '') = COALESCE(dm.type_carton, '')
      -- On affiche seulement les produits qui ont du stock ou qui ont eu un mouvement aujourd'hui
      WHERE cs.stock_aujourdhui > 0 OR dm.ajouts_jour > 0 OR dm.ventes_jour > 0 OR dm.retours_jour > 0 OR dm.rendus_jour > 0
      ORDER BY cs.marque, cs.modele, cs.stockage;
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Erreur lors du calcul du rapport journalier:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération du rapport journalier.' });
  }
});


// Route GET pour les statistiques du tableau de bord (déplacée de remplacements.js pour la cohérence)
router.get('/dashboard-stats', async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    // DÉBOGAGE : Afficher la date actuelle du serveur
    const currentDateResult = await client.query(`SELECT CURRENT_DATE AS server_date;`);
    const serverDate = currentDateResult.rows[0].server_date;
    console.log(`Backend Reports: Date actuelle du serveur (CURRENT_DATE): ${serverDate}`);

    // Total Mobiles en Carton (statut 'active')
    const totalCartonsResult = await client.query(
      `SELECT COALESCE(SUM(quantite), 0) AS total_cartons FROM products WHERE type = 'CARTON' AND status = 'active';`
    );
    const totalCartons = parseInt(totalCartonsResult.rows[0].total_cartons, 10);

    // Total Mobiles en Arrivage (statut 'active')
    const totalArrivageResult = await client.query(
      `SELECT COALESCE(SUM(quantite), 0) AS total_arrivage FROM products WHERE type = 'ARRIVAGE' AND status = 'active';`
    );
    const totalArrivage = parseInt(totalArrivageResult.rows[0].total_arrivage, 10);

    // Total Mobiles Vendus (statut 'actif' dans vente_items)
    const totalVentesResult = await client.query(
      `SELECT COALESCE(SUM(quantite_vendue), 0) AS total_ventes FROM vente_items WHERE statut_vente = 'actif';`
    );
    const totalVentes = parseInt(totalVentesResult.rows[0].total_ventes, 10);

    // Total Mobiles Retournés (statut 'retourne' dans returns)
    const totalReturnedResult = await client.query(
      `SELECT COALESCE(COUNT(id), 0) AS total_returned FROM returns WHERE status = 'retourne';`
    );
    const totalReturned = parseInt(totalReturnedResult.rows[0].total_returned, 10);

    // Total Mobiles Envoyés au Fournisseur (dans remplacer)
    const totalSentToSupplierResult = await client.query(
      `SELECT COALESCE(COUNT(id), 0) AS total_sent_to_supplier FROM remplacer;`
    );
    const totalSentToSupplier = parseInt(totalSentToSupplierResult.rows[0].total_sent_to_supplier, 10);

    // Total Mobiles Rendu (statut 'rendu' dans vente_items)
    const totalRenduResult = await client.query(
      `SELECT COALESCE(SUM(vi.quantite_vendue), 0) AS total_rendu FROM vente_items vi WHERE vi.statut_vente = 'rendu';`
    );
    const totalRendu = parseInt(totalRenduResult.rows[0].total_rendu, 10);

    // --- NOUVELLES STATISTIQUES JOURNALIÈRES ---

    // Produits ajoutés aujourd'hui (Carton)
    const addedTodayCartonResult = await client.query(
      `SELECT COALESCE(COUNT(id), 0) AS count FROM products WHERE type = 'CARTON' AND date_ajout::date = CURRENT_DATE;`
    );
    const addedTodayCarton = parseInt(addedTodayCartonResult.rows[0].count, 10);

    // Produits ajoutés aujourd'hui (Arrivage)
    const addedTodayArrivageResult = await client.query(
      `SELECT COALESCE(COUNT(id), 0) AS count FROM products WHERE type = 'ARRIVAGE' AND date_ajout::date = CURRENT_DATE;`
    );
    const addedTodayArrivage = parseInt(addedTodayArrivageResult.rows[0].count, 10);

    // Pièces vendues aujourd'hui (Carton)
    const soldTodayCartonResult = await client.query(
      `SELECT COALESCE(SUM(vi.quantite_vendue), 0) AS count
       FROM vente_items vi
       JOIN products p ON vi.produit_id = p.id
       JOIN ventes v ON vi.vente_id = v.id
       WHERE p.type = 'CARTON' AND v.date_vente::date = CURRENT_DATE AND vi.statut_vente = 'actif';`
    );
    const soldTodayCarton = parseInt(soldTodayCartonResult.rows[0].count, 10);

    // Pièces vendues aujourd'hui (Arrivage)
    const soldTodayArrivageResult = await client.query(
      `SELECT COALESCE(SUM(vi.quantite_vendue), 0) AS count
       FROM vente_items vi
       JOIN products p ON vi.produit_id = p.id
       JOIN ventes v ON vi.vente_id = v.id
       WHERE p.type = 'ARRIVAGE' AND v.date_vente::date = CURRENT_DATE AND vi.statut_vente = 'actif';`
    );
    const soldTodayArrivage = parseInt(soldTodayArrivageResult.rows[0].count, 10);

    // Pièces retournées aujourd'hui (défectueux - Carton)
    const returnedTodayCartonResult = await client.query(
      `SELECT COALESCE(COUNT(r.id), 0) AS count
       FROM returns r
       JOIN products p ON r.product_id = p.id
       WHERE p.type = 'CARTON' AND r.return_date::date = CURRENT_DATE AND r.status = 'retourne';`
    );
    const returnedTodayCarton = parseInt(returnedTodayCartonResult.rows[0].count, 10);

    // Pièces retournées aujourd'hui (défectueux - Arrivage)
    const returnedTodayArrivageResult = await client.query(
      `SELECT COALESCE(COUNT(r.id), 0) AS count
       FROM returns r
       JOIN products p ON r.product_id = p.id
       WHERE p.type = 'ARRIVAGE' AND r.return_date::date = CURRENT_DATE AND r.status = 'retourne';`
    );
    const returnedTodayArrivage = parseInt(returnedTodayArrivageResult.rows[0].count, 10);

    // Pièces rendues aujourd'hui (Carton)
    const renduTodayCartonResult = await client.query(
      `SELECT COALESCE(SUM(vi.quantite_vendue), 0) AS count
       FROM vente_items vi
       JOIN ventes v ON vi.vente_id = v.id
       JOIN products p ON vi.produit_id = p.id
       WHERE p.type = 'CARTON' AND v.date_vente::date = CURRENT_DATE AND vi.statut_vente = 'rendu';`
    );
    const renduTodayCarton = parseInt(renduTodayCartonResult.rows[0].count, 10);

    // Pièces rendues aujourd'hui (Arrivage)
    const renduTodayArrivageResult = await client.query(
      `SELECT COALESCE(SUM(vi.quantite_vendue), 0) AS count
       FROM vente_items vi
       JOIN ventes v ON vi.vente_id = v.id
       JOIN products p ON vi.produit_id = p.id
       WHERE p.type = 'ARRIVAGE' AND v.date_vente::date = CURRENT_DATE AND vi.statut_vente = 'rendu';`
    );
    const renduTodayArrivage = parseInt(renduTodayArrivageResult.rows[0].count, 10);

    // Calcul du stock d'hier (approximation)
    const yesterdayStockCarton = totalCartons + soldTodayCarton - addedTodayCarton + returnedTodayCarton + renduTodayCarton;
    const yesterdayStockArrivage = totalArrivage + soldTodayArrivage - addedTodayArrivage + returnedTodayArrivage + renduTodayArrivage;

    // Requêtes de facturation
    const invoiceSalesCartonTodayResult = await client.query(`
        SELECT COALESCE(SUM(vi.prix_unitaire_vente * vi.quantite_vendue), 0) AS amount,
               COALESCE(COUNT(vi.id), 0) AS count
        FROM vente_items vi
        JOIN ventes v ON vi.vente_id = v.id
        JOIN factures f ON v.id = f.vente_id
        WHERE vi.type = 'CARTON'
          AND DATE(f.date_facture) = CURRENT_DATE
          AND vi.statut_vente = 'actif';
    `);

    const invoiceSalesArrivageTodayResult = await client.query(`
        SELECT COALESCE(SUM(vi.prix_unitaire_vente * vi.quantite_vendue), 0) AS amount,
               COALESCE(COUNT(vi.id), 0) AS count
        FROM vente_items vi
        JOIN ventes v ON vi.vente_id = v.id
        JOIN factures f ON v.id = f.vente_id
        WHERE vi.type = 'ARRIVAGE'
          AND DATE(f.date_facture) = CURRENT_DATE
          AND vi.statut_vente = 'actif';
    `);
    
    res.status(200).json({
      totalCartons,
      totalArrivage,
      totalVentes,
      totalReturned,
      totalSentToSupplier,
      totalRendu,
      addedTodayCarton,
      addedTodayArrivage,
      soldTodayCarton,
      soldTodayArrivage,
      returnedTodayCarton,
      returnedTodayArrivage,
      renduTodayCarton,
      renduTodayArrivage,
      yesterdayStockCarton: Math.max(0, yesterdayStockCarton),
      yesterdayStockArrivage: Math.max(0, yesterdayStockArrivage),
      invoiceSalesCartonTodayAmount: invoiceSalesCartonTodayResult.rows[0].amount,
      invoiceSalesCartonTodayCount: invoiceSalesCartonTodayResult.rows[0].count,
      invoiceSalesArrivageTodayAmount: invoiceSalesArrivageTodayResult.rows[0].amount,
      invoiceSalesArrivageTodayCount: invoiceSalesArrivageTodayResult.rows[0].count,
    });

  } catch (err) {
    console.error('Erreur lors de la récupération des statistiques du tableau de bord:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des statistiques du tableau de bord.' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

module.exports = router;
