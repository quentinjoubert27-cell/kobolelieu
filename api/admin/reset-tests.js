// ============================================================================
// api/admin/reset-tests.js — Supprimer les réservations de test
// ============================================================================
// DELETE /api/admin/reset-tests
// Body : { token, statuts?: ['en_attente','expiree'] }
//
// Supprime toutes les réservations dont le statut est dans la liste fournie
// (par défaut : en_attente + expiree). Utile en phase de test.
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';

const STATUTS_SUPPRIMABLES = new Set(['en_attente', 'expiree', 'annulee']);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { token, statuts } = req.body || {};

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }

  // Statuts à supprimer (défaut : en_attente + expiree)
  const cibles = Array.isArray(statuts) ? statuts : ['en_attente', 'expiree'];

  // Vérification de sécurité : on n'accepte que les statuts autorisés
  const invalides = cibles.filter(s => !STATUTS_SUPPRIMABLES.has(s));
  if (invalides.length) {
    return res.status(400).json({ error: `Statuts non autorisés : ${invalides.join(', ')}` });
  }

  // On ne permet jamais de supprimer les "confirmee"
  if (cibles.includes('confirmee')) {
    return res.status(400).json({ error: 'Impossible de supprimer des réservations confirmées' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('reservations')
      .delete()
      .in('statut', cibles)
      .select('id');

    if (error) throw error;

    const nb = data?.length ?? 0;
    return res.status(200).json({ ok: true, supprimees: nb });
  } catch (err) {
    console.error('[api/admin/reset-tests]', err);
    return res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
}
