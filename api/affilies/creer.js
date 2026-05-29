// ============================================================================
// api/affilies/creer.js — Crée un affilié + compte Stripe Connect
// ============================================================================
// POST /api/affilies/creer
// Header : x-admin-token: ADMIN_TOKEN
// Body   : { nom, email, code, taux_commission? }
//
// Retourne : { affilie, onboardingUrl, portalUrl }
// ============================================================================

import { supabaseAdmin, stripe, corsHeaders } from '../../lib/clients.js';
import crypto from 'crypto';

function checkAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token && token === process.env.ADMIN_TOKEN;
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  try {
    const { nom, email, code, taux_commission } = req.body || {};

    if (!nom || !email || !code) {
      return res.status(400).json({ error: 'nom, email et code sont requis' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }

    const codeClean = code.toUpperCase().trim().replace(/[^A-Z0-9_-]/g, '');
    if (codeClean.length < 2 || codeClean.length > 20) {
      return res.status(400).json({ error: 'Code invalide (2-20 caractères, lettres/chiffres)' });
    }

    // Récupérer le taux par défaut si non fourni
    let taux = parseFloat(taux_commission);
    if (isNaN(taux)) {
      const { data: settings } = await supabaseAdmin
        .from('affiliation_settings')
        .select('taux_defaut')
        .eq('id', 1)
        .single();
      taux = settings?.taux_defaut ?? 10.00;
    }

    // Token unique pour l'espace affilié
    const token = crypto.randomBytes(32).toString('hex');
    const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';

    // Créer le compte Stripe Connect Express
    let stripeAccountId = null;
    let onboardingUrl = null;

    try {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'FR',
        email,
        capabilities: {
          transfers: { requested: true },
        },
      });
      stripeAccountId = account.id;

      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${siteUrl}/admin-affiliation.html?refresh=1&code=${codeClean}`,
        return_url:  `${siteUrl}/admin-affiliation.html?onboarded=1&code=${codeClean}`,
        type: 'account_onboarding',
      });
      onboardingUrl = accountLink.url;

    } catch (stripeErr) {
      console.error('[affilies/creer] Stripe Connect :', stripeErr.message);
      // On continue même sans Stripe Connect — les commissions seront en attente
    }

    // Insérer l'affilié en base
    const { data: affilie, error } = await supabaseAdmin
      .from('affilies')
      .insert({
        nom,
        email,
        code: codeClean,
        token,
        stripe_account_id: stripeAccountId,
        taux_commission: taux,
      })
      .select('id, nom, email, code, taux_commission, statut, total_clics, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Email ou code déjà utilisé' });
      }
      throw error;
    }

    return res.status(201).json({
      affilie: {
        ...affilie,
        lien_parrainage: `${siteUrl}/reservation.html?ref=${codeClean}`,
      },
      onboardingUrl,    // à envoyer à l'affilié pour qu'il connecte son compte bancaire
      portalUrl: `${siteUrl}/espace-affilie.html?token=${token}`, // son espace perso
    });

  } catch (err) {
    console.error('[affilies/creer]', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
