// ============================================================================
// api/affilies/settings.js — Gestion du taux de commission global
// ============================================================================
// GET  /api/affilies/settings?token=ADMIN_TOKEN   → taux actuel
// POST /api/affilies/settings                     → modifier le taux
//   Body : { taux_defaut: 12.5 }
//   ou   : { affilie_code: "MARIE", taux: 15.0 }  → taux individuel
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

  // GET — lire le taux par défaut
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('affiliation_settings')
      .select('*')
      .eq('id', 1)
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // POST — modifier le taux
  if (req.method === 'POST') {
    const { taux_defaut, affilie_code, taux, statut } = req.body || {};

    // Modifier le statut d'un affilié
    if (affilie_code && statut) {
      if (!['actif', 'suspendu'].includes(statut)) {
        return res.status(400).json({ error: 'Statut invalide' });
      }
      const { data, error } = await supabaseAdmin
        .from('affilies')
        .update({ statut })
        .eq('code', affilie_code.toUpperCase())
        .select('code, statut')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ updated: 'statut', ...data });
    }

    // Modifier le taux d'un affilié spécifique
    if (affilie_code && taux != null) {
      const tauxVal = parseFloat(taux);
      if (isNaN(tauxVal) || tauxVal < 0 || tauxVal > 100) {
        return res.status(400).json({ error: 'Taux invalide (0-100)' });
      }
      const { data, error } = await supabaseAdmin
        .from('affilies')
        .update({ taux_commission: tauxVal })
        .eq('code', affilie_code.toUpperCase())
        .select('code, taux_commission')
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ updated: 'affilie', ...data });
    }

    // Modifier le taux global par défaut
    if (taux_defaut != null) {
      const tauxVal = parseFloat(taux_defaut);
      if (isNaN(tauxVal) || tauxVal < 0 || tauxVal > 100) {
        return res.status(400).json({ error: 'Taux invalide (0-100)' });
      }
      const { data, error } = await supabaseAdmin
        .from('affiliation_settings')
        .update({ taux_defaut: tauxVal, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ updated: 'global', ...data });
    }

    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  return res.status(405).json({ error: 'Méthode non autorisée' });
}
