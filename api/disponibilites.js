// ============================================================================
// api/disponibilites.js — Créneaux disponibles d'une salle pour une date
// ============================================================================
// GET /api/disponibilites?salle=<uuid>&date=2026-05-21
// Renvoie la liste des heures avec leur disponibilité (libre / pris).
// Alimente le calendrier et la grille de créneaux du booker.
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

  // --- Validation des paramètres ---
  if (!salle || !date) {
    return res.status(400).json({ error: 'Paramètres "salle" et "date" requis' });
  }
  // Date au format AAAA-MM-JJ
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Format de date invalide (attendu AAAA-MM-JJ)' });
  }
  // On refuse les dates passées
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(date) < today) {
    return res.status(200).json({ creneaux: [] }); // passé → rien de dispo
  }

  try {
    // 1) On libère d'abord les réservations provisoires expirées
    //    (paiement non finalisé dans les temps) pour ne pas bloquer des créneaux.
    await supabaseAdmin.rpc('liberer_reservations_expirees');

    // 2) On interroge la fonction SQL qui calcule les disponibilités
    const { data, error } = await supabaseAdmin.rpc('creneaux_disponibles', {
      p_salle_id: salle,
      p_date: date,
    });

    if (error) throw error;

    // data = [{ heure: 9, disponible: true }, { heure: 10, disponible: false }, ...]
    return res.status(200).json({ date, creneaux: data });
  } catch (err) {
    console.error('[api/disponibilites]', err);
    return res.status(500).json({ error: 'Impossible de charger les disponibilités' });
  }
}
