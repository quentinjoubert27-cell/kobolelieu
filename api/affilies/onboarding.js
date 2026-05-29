// ============================================================================
// api/affilies/onboarding.js — Génère un nouveau lien d'onboarding Stripe
// ============================================================================
// POST /api/affilies/onboarding
// Header : x-admin-token
// Body   : { code: "MARIE" }
//
// Le lien Stripe Connect expire après ~5 min — cet endpoint en génère un nouveau.
// ============================================================================

import { supabaseAdmin, stripe, corsHeaders } from '../../lib/clients.js';

function checkAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token && token === process.env.ADMIN_TOKEN;
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code requis' });

  try {
    const { data: affilie, error } = await supabaseAdmin
      .from('affilies')
      .select('id, code, email, stripe_account_id, stripe_onboarded')
      .eq('code', code.toUpperCase())
      .single();

    if (error || !affilie) return res.status(404).json({ error: 'Affilié introuvable' });
    if (affilie.stripe_onboarded) return res.status(400).json({ error: 'Déjà onboardé' });

    const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';
    let stripeAccountId = affilie.stripe_account_id;

    // Créer un compte Stripe si absent
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email: affilie.email,
        capabilities: { transfers: { requested: true } },
      });
      stripeAccountId = account.id;
      await supabaseAdmin
        .from('affilies')
        .update({ stripe_account_id: stripeAccountId })
        .eq('id', affilie.id);
    }

    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${siteUrl}/admin-affiliation.html?refresh=1&code=${affilie.code}`,
      return_url:  `${siteUrl}/admin-affiliation.html?onboarded=1&code=${affilie.code}`,
      type: 'account_onboarding',
    });

    return res.status(200).json({ onboardingUrl: accountLink.url });

  } catch (err) {
    console.error('[affilies/onboarding]', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
