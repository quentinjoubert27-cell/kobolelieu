// ============================================================================
// lib/clients.js — Clients partagés Supabase + Stripe
// ============================================================================
// Centralise l'initialisation pour ne pas la répéter dans chaque fonction API.
// Toutes les clés viennent des variables d'environnement Vercel (jamais en dur).
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// ----------------------------------------------------------------------------
// SUPABASE — client "service" (clé service_role)
// ----------------------------------------------------------------------------
// IMPORTANT : la clé service_role contourne la sécurité RLS.
// Elle ne doit JAMAIS être exposée au navigateur — uniquement côté serveur.
// ----------------------------------------------------------------------------
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

// ----------------------------------------------------------------------------
// STRIPE
// ----------------------------------------------------------------------------
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-03-31', // version d'API Stripe fixée (cf. doc Stripe)
});

// ----------------------------------------------------------------------------
// Petites aides
// ----------------------------------------------------------------------------

// Formate un montant (centimes) en euros lisibles : 2500 → "25,00 €"
export function formatEuros(centimes) {
  return (centimes / 100).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
  });
}

// En-têtes CORS — autorise le front à appeler l'API.
// Remplace l'étoile par ton domaine en production : 'https://kobo-bdx.com'
export const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.SITE_URL || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
