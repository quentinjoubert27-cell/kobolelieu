// ============================================================================
// api/creer-reservation.js — Crée la réservation + la session de paiement
// ============================================================================
// POST /api/creer-reservation
// Body JSON : {
//   salleId, formuleSlug, date,
//   heureDebut, heureFin,         // requis SEULEMENT pour la formule "à l'heure"
//   nom, email, tel, entreprise, participants, message
// }
//
// Déroulé :
//  1. Valide les données reçues
//  2. Charge la formule et la salle DEPUIS la base (jamais les prix client)
//  3. Calcule la plage horaire et le montant
//  4. Vérifie la disponibilité du créneau
//  5. Crée une réservation "en_attente"
//  6. Crée la session Stripe Checkout
//  7. Renvoie l'URL de paiement
// ============================================================================

import { supabaseAdmin, stripe, corsHeaders, formatEuros } from '../lib/clients.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin']).end();
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  try {
    const {
      salleId, formuleSlug, date,
      heureDebut, heureFin,
      nom, email, tel, entreprise, participants, message,
    } = req.body || {};

    // ----------------------------------------------------------------
    // 1) VALIDATION
    // ----------------------------------------------------------------
    if (!salleId || !formuleSlug || !date) {
      return res.status(400).json({ error: 'Informations incomplètes' });
    }
    if (!nom || !email) {
      return res.status(400).json({ error: 'Nom et email requis' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date invalide' });
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (new Date(date) < today) {
      return res.status(400).json({ error: 'Date passée' });
    }

    // ----------------------------------------------------------------
    // 2) CHARGER FORMULE + SALLE depuis la base
    // ----------------------------------------------------------------
    const [
      { data: formule, error: errFormule },
      { data: salle, error: errSalle },
    ] = await Promise.all([
      supabaseAdmin.from('formules').select('*').eq('slug', formuleSlug).eq('actif', true).single(),
      supabaseAdmin.from('salles').select('id, nom, sur_devis, actif').eq('id', salleId).single(),
    ]);

    if (errFormule || !formule) return res.status(404).json({ error: 'Formule introuvable' });
    if (errSalle || !salle)     return res.status(404).json({ error: 'Salle introuvable' });
    if (!salle.actif)           return res.status(400).json({ error: 'Salle non réservable' });
    if (salle.sur_devis)        return res.status(400).json({ error: 'Cette salle est sur devis' });

    // ----------------------------------------------------------------
    // 3) CALCUL DE LA PLAGE HORAIRE ET DU MONTANT
    // ----------------------------------------------------------------
    let hDebut, hFin, montantTotal;

    if (formule.a_la_carte) {
      // Formule "à l'heure" : le client choisit son créneau
      hDebut = parseInt(heureDebut, 10);
      hFin = parseInt(heureFin, 10);
      if (isNaN(hDebut) || isNaN(hFin) || hFin <= hDebut) {
        return res.status(400).json({ error: 'Plage horaire invalide pour la formule à l\'heure' });
      }
      // La plage doit rester dans les bornes de la formule horaire
      if (hDebut < formule.heure_debut || hFin > formule.heure_fin) {
        return res.status(400).json({
          error: `Plage hors créneaux ouvrables (${formule.heure_debut}h–${formule.heure_fin}h)`,
        });
      }
      // Prix = prix horaire × nombre d'heures
      const dureeHeures = hFin - hDebut;
      montantTotal = formule.prix * dureeHeures;
    } else {
      // Formule fixe : plage imposée
      hDebut = formule.heure_debut;
      hFin = formule.heure_fin;
      montantTotal = formule.prix;
    }

    // ----------------------------------------------------------------
    // 4) VÉRIFIER LA DISPONIBILITÉ
    // ----------------------------------------------------------------
    await supabaseAdmin.rpc('liberer_reservations_expirees');

    const { data: creneaux, error: errDispo } = await supabaseAdmin.rpc(
      'creneaux_disponibles',
      { p_salle_id: salleId, p_date: date }
    );
    if (errDispo) throw errDispo;

    const heuresVoulues = [];
    for (let h = hDebut; h < hFin; h++) heuresVoulues.push(h);

    const toutesLibres = heuresVoulues.every((h) => {
      const c = creneaux.find((x) => x.heure === h);
      return c && c.disponible;
    });

    if (!toutesLibres) {
      return res.status(409).json({
        error: 'Ce créneau vient d\'être réservé. Choisissez une autre formule ou date.',
      });
    }

    // ----------------------------------------------------------------
    // 5) CRÉER LA RÉSERVATION PROVISOIRE
    // ----------------------------------------------------------------
    const { data: resa, error: errResa } = await supabaseAdmin
      .from('reservations')
      .insert({
        salle_id: salleId,
        formule_id: formule.id,
        date_resa: date,
        heure_debut: hDebut,
        heure_fin: hFin,
        client_nom: nom,
        client_email: email,
        client_tel: tel || null,
        client_entreprise: entreprise || null,
        nb_participants: participants ? parseInt(participants, 10) : null,
        message: message || null,
        montant_total: montantTotal,
        statut: 'en_attente',
      })
      .select()
      .single();

    if (errResa) {
      if (errResa.code === '23P01') {
        return res.status(409).json({
          error: 'Ce créneau vient d\'être réservé. Choisissez une autre formule ou date.',
        });
      }
      throw errResa;
    }

    // ----------------------------------------------------------------
    // 6) CRÉER LA SESSION STRIPE CHECKOUT
    // ----------------------------------------------------------------
    const siteUrl = process.env.SITE_URL || 'https://kobo-bdx.com';
    const dureeHeures = hFin - hDebut;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      client_reference_id: resa.id,

      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Salle ${salle.nom} — ${formule.nom}`,
            description: `${date} · ${String(hDebut).padStart(2,'0')}h–${String(hFin).padStart(2,'0')}h · ${dureeHeures}h`,
          },
          unit_amount: montantTotal,
        },
        quantity: 1,
      }],

      metadata: {
        reservation_id: resa.id,
        salle: salle.nom,
        formule: formule.nom,
        date,
        creneau: `${hDebut}h-${hFin}h`,
      },
      payment_intent_data: {
        metadata: { reservation_id: resa.id },
      },

      success_url: `${siteUrl}/reservation-confirmee.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/reservation.html?annule=1`,

      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      locale: 'fr',
    });

    // ----------------------------------------------------------------
    // 7) ENREGISTRER L'ID STRIPE ET RÉPONDRE
    // ----------------------------------------------------------------
    await supabaseAdmin
      .from('reservations')
      .update({ stripe_session_id: session.id })
      .eq('id', resa.id);

    return res.status(200).json({
      reservationId: resa.id,
      montant: montantTotal,
      montantLisible: formatEuros(montantTotal),
      checkoutUrl: session.url,
    });
  } catch (err) {
    console.error('[api/creer-reservation]', err);
    return res.status(500).json({
      error: 'Une erreur est survenue lors de la création de la réservation',
    });
  }
}
