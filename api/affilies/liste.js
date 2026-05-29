// ============================================================================
// api/affilies/liste.js — Liste de tous les affiliés + stats (admin)
// ============================================================================
// GET /api/affilies/liste?token=ADMIN_TOKEN
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';

function checkAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token && token === process.env.ADMIN_TOKEN;
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const [affiliesRes, settingsRes] = await Promise.all([
      supabaseAdmin
        .from('affilies')
        .select('id, nom, email, code, taux_commission, statut, total_clics, stripe_onboarded, created_at')
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('affiliation_settings')
        .select('taux_defaut')
        .eq('id', 1)
        .single(),
    ]);

    if (affiliesRes.error) throw affiliesRes.error;

    const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';

    // Pour chaque affilié, charger ses stats de commissions
    const affiliesIds = affiliesRes.data.map(a => a.id);
    let commissionsMap = {};

    if (affiliesIds.length > 0) {
      const { data: commissions } = await supabaseAdmin
        .from('commissions')
        .select('affilie_id, montant_commission, statut')
        .in('affilie_id', affiliesIds);

      (commissions || []).forEach(c => {
        if (!commissionsMap[c.affilie_id]) {
          commissionsMap[c.affilie_id] = { total: 0, en_attente: 0, verse: 0, nb: 0 };
        }
        commissionsMap[c.affilie_id].nb++;
        commissionsMap[c.affilie_id].total += c.montant_commission;
        if (c.statut === 'en_attente') commissionsMap[c.affilie_id].en_attente += c.montant_commission;
        if (c.statut === 'verse')      commissionsMap[c.affilie_id].verse += c.montant_commission;
      });
    }

    const affilies = affiliesRes.data.map(a => ({
      ...a,
      lien_parrainage: `${siteUrl}/reservation.html?ref=${a.code}`,
      nb_reservations: commissionsMap[a.id]?.nb ?? 0,
      commission_en_attente: commissionsMap[a.id]?.en_attente ?? 0,
      commission_versee: commissionsMap[a.id]?.verse ?? 0,
    }));

    return res.status(200).json({
      affilies,
      taux_defaut: settingsRes.data?.taux_defaut ?? 10.00,
    });

  } catch (err) {
    console.error('[affilies/liste]', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
