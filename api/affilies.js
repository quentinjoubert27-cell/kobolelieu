// ============================================================================
// api/affilies.js — Toutes les routes du système d'affiliation
// ============================================================================
// Routing interne par ?action= pour rester dans la limite Vercel Hobby (12 fn)
//
//  GET  /api/affilies?action=liste       → liste affiliés (admin)
//  GET  /api/affilies?action=stats       → stats affilié (token)
//  GET  /api/affilies?action=settings    → taux global (admin)
//  POST /api/affilies?action=creer       → créer affilié (admin)
//  POST /api/affilies?action=settings    → modifier taux (admin)
//  POST /api/affilies?action=clic        → enregistrer clic (public)
//  POST /api/affilies?action=onboarding  → lien Stripe Connect (admin)
// ============================================================================

import { supabaseAdmin, stripe, corsHeaders } from '../lib/clients.js';
import { randomBytes } from 'crypto';

// ── Auth ─────────────────────────────────────────────────────────────────────
function checkAdmin(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  return token && token === process.env.ADMIN_TOKEN;
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;

  try {
    switch (action) {
      case 'creer':      return await creer(req, res);
      case 'liste':      return await liste(req, res);
      case 'stats':      return await stats(req, res);
      case 'settings':   return await settings(req, res);
      case 'clic':       return await clic(req, res);
      case 'onboarding': return await onboarding(req, res);
      default:
        return res.status(400).json({ error: 'Action inconnue' });
    }
  } catch (err) {
    console.error(`[affilies/${action}]`, err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}

// ── CREER ────────────────────────────────────────────────────────────────────
async function creer(req, res) {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (req.method !== 'POST') return res.status(405).end();

  const { nom, email, code, taux_commission } = req.body || {};
  if (!nom || !email || !code) return res.status(400).json({ error: 'nom, email et code requis' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Email invalide' });

  const codeClean = code.toUpperCase().trim().replace(/[^A-Z0-9_-]/g, '');
  if (codeClean.length < 2 || codeClean.length > 20) return res.status(400).json({ error: 'Code invalide (2-20 caractères)' });

  let taux = parseFloat(taux_commission);
  if (isNaN(taux)) {
    const { data: s } = await supabaseAdmin.from('affiliation_settings').select('taux_defaut').eq('id', 1).single();
    taux = s?.taux_defaut ?? 10.00;
  }

  const token = randomBytes(32).toString('hex');
  const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';

  let stripeAccountId = null, onboardingUrl = null;
  try {
    const account = await stripe.accounts.create({ type: 'express', country: 'FR', email, capabilities: { transfers: { requested: true } } });
    stripeAccountId = account.id;
    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${siteUrl}/admin-affiliation?refresh=1&code=${codeClean}`,
      return_url:  `${siteUrl}/admin-affiliation?onboarded=1&code=${codeClean}`,
      type: 'account_onboarding',
    });
    onboardingUrl = link.url;
  } catch (e) {
    console.error('[affilies/creer] Stripe Connect :', e.message);
  }

  const { data: affilie, error } = await supabaseAdmin.from('affilies')
    .insert({ nom, email, code: codeClean, token, stripe_account_id: stripeAccountId, taux_commission: taux })
    .select('id, nom, email, code, taux_commission, statut, total_clics, created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email ou code déjà utilisé' });
    throw error;
  }

  return res.status(201).json({
    affilie: { ...affilie, lien_parrainage: `${siteUrl}/reservation?ref=${codeClean}` },
    onboardingUrl,
    portalUrl: `${siteUrl}/espace-affilie?token=${token}`,
  });
}

// ── LISTE ────────────────────────────────────────────────────────────────────
async function liste(req, res) {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (req.method !== 'GET') return res.status(405).end();

  const [affiliesRes, settingsRes] = await Promise.all([
    supabaseAdmin.from('affilies').select('id, nom, email, code, taux_commission, statut, total_clics, stripe_onboarded, created_at').order('created_at', { ascending: false }),
    supabaseAdmin.from('affiliation_settings').select('taux_defaut').eq('id', 1).single(),
  ]);
  if (affiliesRes.error) throw affiliesRes.error;

  const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';
  const ids = affiliesRes.data.map(a => a.id);
  let commissionsMap = {};

  if (ids.length > 0) {
    const { data: comms } = await supabaseAdmin.from('commissions').select('affilie_id, montant_commission, statut').in('affilie_id', ids);
    (comms || []).forEach(c => {
      if (!commissionsMap[c.affilie_id]) commissionsMap[c.affilie_id] = { nb: 0, en_attente: 0, verse: 0 };
      commissionsMap[c.affilie_id].nb++;
      if (c.statut === 'en_attente') commissionsMap[c.affilie_id].en_attente += c.montant_commission;
      if (c.statut === 'verse')      commissionsMap[c.affilie_id].verse += c.montant_commission;
    });
  }

  return res.status(200).json({
    affilies: affiliesRes.data.map(a => ({
      ...a,
      lien_parrainage: `${siteUrl}/reservation?ref=${a.code}`,
      nb_reservations: commissionsMap[a.id]?.nb ?? 0,
      commission_en_attente: commissionsMap[a.id]?.en_attente ?? 0,
      commission_versee: commissionsMap[a.id]?.verse ?? 0,
    })),
    taux_defaut: settingsRes.data?.taux_defaut ?? 10.00,
  });
}

// ── STATS ────────────────────────────────────────────────────────────────────
async function stats(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requis' });

  const { data: affilie, error } = await supabaseAdmin.from('affilies')
    .select('id, nom, email, code, taux_commission, statut, total_clics, created_at')
    .eq('token', token).single();

  if (error || !affilie) return res.status(404).json({ error: 'Lien invalide ou expiré' });
  if (affilie.statut === 'suspendu') return res.status(403).json({ error: 'Compte suspendu' });

  const { data: comms } = await supabaseAdmin.from('commissions')
    .select('id, montant_reservation, taux, montant_commission, statut, created_at, paid_at, reservations(date_resa, heure_debut, heure_fin, salles(nom))')
    .eq('affilie_id', affilie.id).order('created_at', { ascending: false });

  const all = comms || [];
  const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';

  return res.status(200).json({
    nom: affilie.nom, email: affilie.email, code: affilie.code, taux: affilie.taux_commission,
    lien: `${siteUrl}/reservation?ref=${affilie.code}`,
    total_clics: affilie.total_clics,
    nb_reservations: all.length,
    montant_en_attente: all.filter(c => c.statut === 'en_attente').reduce((s, c) => s + c.montant_commission, 0),
    montant_verse:      all.filter(c => c.statut === 'verse').reduce((s, c) => s + c.montant_commission, 0),
    historique: all.map(c => ({
      date: c.created_at, salle: c.reservations?.salles?.nom ?? '—',
      date_resa: c.reservations?.date_resa ?? '—',
      montant_resa: c.montant_reservation, taux: c.taux,
      commission: c.montant_commission, statut: c.statut, paid_at: c.paid_at,
    })),
  });
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────
async function settings(req, res) {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('affiliation_settings').select('*').eq('id', 1).single();
    if (error) throw error;
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { taux_defaut, affilie_code, taux, statut } = req.body || {};

    // Statut d'un affilié
    if (affilie_code && statut) {
      if (!['actif', 'suspendu'].includes(statut)) return res.status(400).json({ error: 'Statut invalide' });
      const { data, error } = await supabaseAdmin.from('affilies').update({ statut }).eq('code', affilie_code.toUpperCase()).select('code, statut').single();
      if (error) throw error;
      return res.status(200).json({ updated: 'statut', ...data });
    }

    // Taux d'un affilié
    if (affilie_code && taux != null) {
      const t = parseFloat(taux);
      if (isNaN(t) || t < 0 || t > 100) return res.status(400).json({ error: 'Taux invalide' });
      const { data, error } = await supabaseAdmin.from('affilies').update({ taux_commission: t }).eq('code', affilie_code.toUpperCase()).select('code, taux_commission').single();
      if (error) throw error;
      return res.status(200).json({ updated: 'affilie', ...data });
    }

    // Taux global
    if (taux_defaut != null) {
      const t = parseFloat(taux_defaut);
      if (isNaN(t) || t < 0 || t > 100) return res.status(400).json({ error: 'Taux invalide' });
      const { data, error } = await supabaseAdmin.from('affiliation_settings').update({ taux_defaut: t, updated_at: new Date().toISOString() }).eq('id', 1).select().single();
      if (error) throw error;
      return res.status(200).json({ updated: 'global', ...data });
    }

    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  return res.status(405).end();
}

// ── CLIC ─────────────────────────────────────────────────────────────────────
async function clic(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Code requis' });
  await supabaseAdmin.rpc('increment_clics', { p_code: code.toUpperCase().trim() });
  return res.status(200).json({ ok: true });
}

// ── ONBOARDING ───────────────────────────────────────────────────────────────
async function onboarding(req, res) {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (req.method !== 'POST') return res.status(405).end();

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code requis' });

  const { data: affilie, error } = await supabaseAdmin.from('affilies')
    .select('id, code, email, stripe_account_id, stripe_onboarded')
    .eq('code', code.toUpperCase()).single();

  if (error || !affilie) return res.status(404).json({ error: 'Affilié introuvable' });
  if (affilie.stripe_onboarded) return res.status(400).json({ error: 'Déjà onboardé' });

  const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';
  let stripeAccountId = affilie.stripe_account_id;

  if (!stripeAccountId) {
    const account = await stripe.accounts.create({ type: 'express', country: 'FR', email: affilie.email, capabilities: { transfers: { requested: true } } });
    stripeAccountId = account.id;
    await supabaseAdmin.from('affilies').update({ stripe_account_id: stripeAccountId }).eq('id', affilie.id);
  }

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${siteUrl}/admin-affiliation?refresh=1&code=${affilie.code}`,
    return_url:  `${siteUrl}/admin-affiliation?onboarded=1&code=${affilie.code}`,
    type: 'account_onboarding',
  });

  return res.status(200).json({ onboardingUrl: link.url });
}
