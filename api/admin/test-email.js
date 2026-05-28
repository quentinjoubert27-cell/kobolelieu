// ============================================================================
// api/admin/test-email.js — Diagnostic email (à supprimer après test)
// ============================================================================
// POST /api/admin/test-email
// Body : { token, to }   ← envoie un email de test à l'adresse "to"
// ============================================================================

import { Resend } from 'resend';
import { corsHeaders } from '../../lib/clients.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).end();

  const { token, to } = req.body || {};
  if (!token || token !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'Non autorisé' });
  if (!to) return res.status(400).json({ error: 'Champ "to" manquant' });

  // Infos de config
  const config = {
    RESEND_API_KEY: process.env.RESEND_API_KEY ? `présente (${process.env.RESEND_API_KEY.slice(0,6)}…)` : '❌ MANQUANTE',
    EMAIL_FROM: process.env.EMAIL_FROM || '❌ NON DÉFINI (défaut: reservation@kobo-bdx.com)',
    EMAIL_ADMIN: process.env.EMAIL_ADMIN || '❌ NON DÉFINI (défaut: hello@kobo-bdx.com)',
    SITE_URL: process.env.SITE_URL || '❌ NON DÉFINI',
  };

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ ok: false, config, erreur: 'RESEND_API_KEY manquante dans Vercel' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM || 'Kōbō Le Lieu <reservation@kobo-bdx.com>';

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: '✅ Test email Kōbō — diagnostic',
    html: `<p>Si tu reçois cet email, Resend fonctionne correctement.<br><br>Expéditeur : <strong>${from}</strong></p>`,
  });

  if (error) {
    return res.status(200).json({ ok: false, config, erreur: error.message || JSON.stringify(error), detail: error });
  }

  return res.status(200).json({ ok: true, config, messageId: data?.id });
}
