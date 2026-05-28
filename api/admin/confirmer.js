// ============================================================================
// api/admin/confirmer.js — Confirmer manuellement une réservation + renvoi email
// ============================================================================
// POST /api/admin/confirmer
// Body : { token, reservationId, renvoyerEmail?: boolean }
//
// Deux usages :
//  1. confirmer une résa "en_attente" (webhook Stripe raté) → statut "confirmee" + emails
//  2. renvoi email uniquement (renvoyerEmail:true, resa déjà confirmée)
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';
import {
  envoyerEmailConfirmation,
  envoyerEmailNotificationAdmin,
} from '../../lib/email.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { token, reservationId, renvoyerEmail = false } = req.body || {};

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }
  if (!reservationId) {
    return res.status(400).json({ error: 'reservationId manquant' });
  }

  try {
    let resa;

    if (renvoyerEmail) {
      // Mode renvoi email seul — on récupère la résa sans changer le statut
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .select('*, salles(nom, couleur), formules(nom)')
        .eq('id', reservationId)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Réservation introuvable' });
      resa = data;
    } else {
      // Mode confirmation manuelle — passe en "confirmee" seulement si "en_attente"
      const { data, error } = await supabaseAdmin
        .from('reservations')
        .update({ statut: 'confirmee', confirmed_at: new Date().toISOString() })
        .eq('id', reservationId)
        .in('statut', ['en_attente'])
        .select('*, salles(nom, couleur), formules(nom)')
        .single();

      if (error) return res.status(500).json({ error: 'Erreur lors de la confirmation' });
      if (!data) {
        // Déjà confirmée ou introuvable → on récupère juste pour le renvoi email
        const { data: existing } = await supabaseAdmin
          .from('reservations')
          .select('*, salles(nom, couleur), formules(nom)')
          .eq('id', reservationId)
          .single();
        if (!existing) return res.status(404).json({ error: 'Réservation introuvable' });
        resa = existing;
      } else {
        resa = data;
      }
    }

    // Envoyer les emails
    await Promise.allSettled([
      envoyerEmailConfirmation(resa)
        .catch(e => { throw new Error('Email client : ' + e.message) }),
      envoyerEmailNotificationAdmin(resa)
        .catch(e => console.error('Email admin :', e.message)),
    ]);

    return res.status(200).json({ ok: true, statut: resa.statut });
  } catch (err) {
    console.error('[api/admin/confirmer]', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
