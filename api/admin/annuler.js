// ============================================================================
// api/admin/annuler.js — Annuler une réservation
// ============================================================================
// POST /api/admin/annuler
// Body : { token, reservationId, rembourser: true|false, prevenirClient: true|false }
//
// Si rembourser=true et que la résa était confirmée et payée :
//   → on lance un remboursement intégral via Stripe.
// Si prevenirClient=true :
//   → envoie un email d'annulation au client.
// ============================================================================

import { supabaseAdmin, stripe, corsHeaders } from '../../lib/clients.js';
import { envoyerEmailAnnulation } from '../../lib/email.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { token, reservationId, rembourser = true, prevenirClient = true } = req.body || {};

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }
  if (!reservationId) {
    return res.status(400).json({ error: 'reservationId requis' });
  }

  try {
    // Charger la résa
    const { data: resa, error: errCharge } = await supabaseAdmin
      .from('reservations')
      .select('*, salles(nom), formules(nom)')
      .eq('id', reservationId)
      .single();

    if (errCharge || !resa) {
      return res.status(404).json({ error: 'Réservation introuvable' });
    }
    if (resa.statut === 'annulee') {
      return res.status(400).json({ error: 'Réservation déjà annulée' });
    }

    // Remboursement Stripe (si demandé et payée)
    let remboursement = null;
    if (rembourser && resa.statut === 'confirmee' && resa.stripe_payment_id) {
      try {
        remboursement = await stripe.refunds.create({
          payment_intent: resa.stripe_payment_id,
        });
      } catch (e) {
        console.error('[admin/annuler] échec remboursement Stripe :', e.message);
        return res.status(500).json({
          error: 'Le remboursement Stripe a échoué. Annulation arrêtée par sécurité.'
        });
      }
    }

    // Mettre à jour la résa
    const { error: errMaj } = await supabaseAdmin
      .from('reservations')
      .update({ statut: 'annulee' })
      .eq('id', reservationId);
    if (errMaj) throw errMaj;

    // Audit log
    await supabaseAdmin.from('admin_log').insert({
      reservation_id: reservationId,
      action: 'annulation',
      details: {
        rembourse: !!remboursement,
        refund_id: remboursement?.id,
        montant_rembourse: remboursement?.amount,
      },
    });

    // Email d'annulation
    if (prevenirClient) {
      try { await envoyerEmailAnnulation(resa); }
      catch (e) { console.error('[admin/annuler] email annulation :', e.message); }
    }

    return res.status(200).json({
      ok: true,
      rembourse: !!remboursement,
      montant_rembourse: remboursement?.amount || 0,
    });
  } catch (err) {
    console.error('[api/admin/annuler]', err);
    return res.status(500).json({ error: 'Erreur lors de l\'annulation' });
  }
}
