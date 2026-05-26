// ============================================================================
// api/formules.js — Formules tarifaires disponibles
// ============================================================================
// GET /api/formules?salle=<uuid>&date=AAAA-MM-JJ
//
// Renvoie la liste des formules (journée, matinée, après-midi, soirée,
// à l'heure) avec leur disponibilité pour la salle et la date demandées.
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../lib/clients.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { salle, date } = req.query;

  if (!salle || !date) {
    return res.status(400).json({ error: 'Paramètres "salle" et "date" requis' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Format de date invalide' });
  }

  try {
    // Libérer les résa expirées avant le calcul
    await supabaseAdmin.rpc('liberer_reservations_expirees');

    const { data, error } = await supabaseAdmin.rpc('formules_disponibles', {
      p_salle_id: salle,
      p_date: date,
    });
    if (error) throw error;

    return res.status(200).json({ date, formules: data });
  } catch (err) {
    console.error('[api/formules]', err);
    return res.status(500).json({ error: 'Impossible de charger les formules' });
  }
}
