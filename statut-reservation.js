// ============================================================================
// api/statut-reservation.js — Statut d'une réservation
// ============================================================================
// GET /api/statut-reservation?session_id=cs_xxx
// Utilisé par la page "reservation-confirmee.html" au retour de Stripe,
// pour afficher au client le récapitulatif de SA réservation.
//
// Note : on cherche par stripe_session_id (et non par id de réservation)
// pour qu'un visiteur ne puisse pas consulter une résa au hasard.
// ============================================================================

import { supabaseAdmin, corsHeaders, formatEuros } from '../lib/clients.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }

  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: 'session_id requis' });
  }

  try {
    const { data: resa, error } = await supabaseAdmin
      .from('reservations')
      .select('id, date_resa, heure_debut, heure_fin, client_nom, montant_total, statut, salles(nom)')
      .eq('stripe_session_id', session_id)
      .single();

    if (error || !resa) {
      return res.status(404).json({ error: 'Réservation introuvable' });
    }

    return res.status(200).json({
      statut: resa.statut, // 'confirmee' attendu si paiement OK
      reservation: {
        salle: resa.salles?.nom,
        date: resa.date_resa,
        heureDebut: resa.heure_debut,
        heureFin: resa.heure_fin,
        nom: resa.client_nom,
        montant: resa.montant_total,
        montantLisible: formatEuros(resa.montant_total),
      },
    });
  } catch (err) {
    console.error('[api/statut-reservation]', err);
    return res.status(500).json({ error: 'Erreur lors de la vérification' });
  }
}
