// ============================================================================
// api/admin/modifier.js — Modifier une réservation
// ============================================================================
// POST /api/admin/modifier
// Body : { token, reservationId, champs: { client_nom?, client_email?, ... } }
//
// On limite volontairement les champs modifiables aux infos client et au
// message — pas la date/heure ni le montant (ce serait une nouvelle résa,
// avec re-vérification de disponibilité et nouveau paiement).
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';

const CHAMPS_AUTORISES = new Set([
  'client_nom',
  'client_email',
  'client_tel',
  'client_entreprise',
  'nb_participants',
  'message',
  'heure_debut',
  'heure_fin',
]);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { token, reservationId, champs } = req.body || {};

  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Accès non autorisé' });
  }
  if (!reservationId || !champs || typeof champs !== 'object') {
    return res.status(400).json({ error: 'Données incomplètes' });
  }

  // Filtre : on ne garde que les champs autorisés
  const maj = {};
  for (const [k, v] of Object.entries(champs)) {
    if (CHAMPS_AUTORISES.has(k)) {
      maj[k] = v;
    }
  }
  if (Object.keys(maj).length === 0) {
    return res.status(400).json({ error: 'Aucun champ modifiable fourni' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('reservations')
      .update(maj)
      .eq('id', reservationId);
    if (error) throw error;

    await supabaseAdmin.from('admin_log').insert({
      reservation_id: reservationId,
      action: 'modification',
      details: { champs: Object.keys(maj) },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[api/admin/modifier]', err);
    return res.status(500).json({ error: 'Erreur de modification' });
  }
}
