// ============================================================================
// api/salles.js — Liste les salles réservables
// ============================================================================
// GET /api/salles
// Renvoie les salles actives (nom, prix, capacité, équipements…).
// Lecture publique : utilisée pour afficher les cartes du booker.
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../lib/clients.js';

export default async function handler(req, res) {
  // Pré-vol CORS
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }

  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('salles')
      .select('id, slug, nom, description, capacite, surface_m2, prix_heure, couleur, equipements, photos, sur_devis, ordre')
      .eq('actif', true)
      .order('ordre', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ salles: data });
  } catch (err) {
    console.error('[api/salles]', err);
    return res.status(500).json({ error: 'Impossible de charger les salles' });
  }
}
