// ============================================================================
// api/admin/reservations.js — Liste des réservations (page admin)
// ============================================================================
// GET /api/admin/reservations?token=XXX[&du=AAAA-MM-JJ&au=AAAA-MM-JJ]
//
// Renvoie toutes les réservations sur la plage de dates demandée (par défaut
// : les 14 prochains jours). Inclut le nom de la salle et de la formule.
//
// Protégé par le token ADMIN_TOKEN (variable d'environnement).
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  // ----- Vérification du token admin -----
  const token = req.query.token || req.headers['x-admin-token'];
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }

  // ----- Plage de dates -----
  const aujourdhui = new Date();
  const par_defaut_du = aujourdhui.toISOString().slice(0, 10);
  const par_defaut_au = new Date(aujourdhui.getTime() + 14 * 86400000).toISOString().slice(0, 10);

  const du = req.query.du || par_defaut_du;
  const au = req.query.au || par_defaut_au;

  try {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .select(`
        id, date_resa, heure_debut, heure_fin,
        client_nom, client_email, client_tel, client_entreprise,
        nb_participants, message,
        montant_total, statut, created_at, confirmed_at,
        salles(id, nom, couleur),
        formules(id, nom, slug)
      `)
      .gte('date_resa', du)
      .lte('date_resa', au)
      .order('date_resa', { ascending: true })
      .order('heure_debut', { ascending: true });

    if (error) throw error;

    // Stats rapides
    const stats = {
      total: data.length,
      confirmees: data.filter(r => r.statut === 'confirmee').length,
      en_attente: data.filter(r => r.statut === 'en_attente').length,
      annulees: data.filter(r => r.statut === 'annulee').length,
      ca_total: data
        .filter(r => r.statut === 'confirmee')
        .reduce((s, r) => s + (r.montant_total || 0), 0),
    };

    return res.status(200).json({ du, au, stats, reservations: data });
  } catch (err) {
    console.error('[api/admin/reservations]', err);
    return res.status(500).json({ error: 'Erreur lors du chargement' });
  }
}
