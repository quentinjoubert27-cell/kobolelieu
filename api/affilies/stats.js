// ============================================================================
// api/affilies/stats.js — Stats de l'affilié pour son espace personnel
// ============================================================================
// GET /api/affilies/stats?token=SECRET_TOKEN
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requis' });

  try {
    // Trouver l'affilié par token
    const { data: affilie, error: errAffilie } = await supabaseAdmin
      .from('affilies')
      .select('id, nom, email, code, taux_commission, statut, total_clics, created_at')
      .eq('token', token)
      .single();

    if (errAffilie || !affilie) {
      return res.status(404).json({ error: 'Lien invalide ou expiré' });
    }
    if (affilie.statut === 'suspendu') {
      return res.status(403).json({ error: 'Votre compte affilié est suspendu. Contactez-nous.' });
    }

    // Charger les commissions
    const { data: commissions } = await supabaseAdmin
      .from('commissions')
      .select(`
        id, montant_reservation, taux, montant_commission, statut, created_at, paid_at,
        reservations(date_resa, heure_debut, heure_fin, salles(nom))
      `)
      .eq('affilie_id', affilie.id)
      .order('created_at', { ascending: false });

    const comms = commissions || [];
    const enAttente = comms.filter(c => c.statut === 'en_attente');
    const versee    = comms.filter(c => c.statut === 'verse');

    const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';

    return res.status(200).json({
      nom:           affilie.nom,
      email:         affilie.email,
      code:          affilie.code,
      taux:          affilie.taux_commission,
      lien:          `${siteUrl}/reservation.html?ref=${affilie.code}`,
      total_clics:   affilie.total_clics,
      nb_reservations: comms.length,
      montant_en_attente: enAttente.reduce((s, c) => s + c.montant_commission, 0),
      montant_verse:      versee.reduce((s, c) => s + c.montant_commission, 0),
      historique: comms.map(c => ({
        date:             c.created_at,
        salle:            c.reservations?.salles?.nom ?? '—',
        date_resa:        c.reservations?.date_resa ?? '—',
        heure_debut:      c.reservations?.heure_debut,
        heure_fin:        c.reservations?.heure_fin,
        montant_resa:     c.montant_reservation,
        taux:             c.taux,
        commission:       c.montant_commission,
        statut:           c.statut,
        paid_at:          c.paid_at,
      })),
    });

  } catch (err) {
    console.error('[affilies/stats]', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
