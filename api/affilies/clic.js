// ============================================================================
// api/affilies/clic.js — Enregistre un clic sur un lien affilié
// ============================================================================
// POST /api/affilies/clic
// Body : { code: "MARIE" }
// ============================================================================

import { supabaseAdmin, corsHeaders } from '../../lib/clients.js';

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Code requis' });
  }

  try {
    await supabaseAdmin.rpc('increment_clics', {
      p_code: code.toUpperCase().trim(),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Erreur silencieuse côté client — pas critique
    console.error('[affilies/clic]', err.message);
    return res.status(200).json({ ok: false });
  }
}
