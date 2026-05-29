// ============================================================================
// api/webhook-stripe.js — Réception des événements Stripe
// ============================================================================
// Confirme la réservation côté serveur (source de vérité du paiement) et
// envoie DEUX emails : un au client, un à l'admin (notification).
// ============================================================================

import { supabaseAdmin, stripe } from '../lib/clients.js';
import {
  envoyerEmailConfirmation,
  envoyerEmailNotificationAdmin,
} from '../lib/email.js';

export const config = {
  api: { bodyParser: false },
};

function lireCorpsBrut(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => resolve(Buffer.concat(morceaux)));
    req.on('error', reject);
  });
}

// ============================================================================
// Gestion de la commission affilié
// ============================================================================
async function traiterCommission({ affilieCode, resa, session }) {
  // 1. Trouver l'affilié
  const { data: affilie, error: errAff } = await supabaseAdmin
    .from('affilies')
    .select('id, taux_commission, stripe_account_id, stripe_onboarded, statut')
    .eq('code', affilieCode.toUpperCase())
    .single();

  if (errAff || !affilie) {
    console.warn(`[commission] affilié "${affilieCode}" introuvable`);
    return;
  }
  if (affilie.statut === 'suspendu') {
    console.warn(`[commission] affilié "${affilieCode}" suspendu`);
    return;
  }

  // 2. Calculer la commission (arrondi à l'entier inférieur en centimes)
  const montantCommission = Math.floor(resa.montant_total * (affilie.taux_commission / 100));
  if (montantCommission <= 0) return;

  // 3. Insérer la commission en base
  const { data: commission, error: errComm } = await supabaseAdmin
    .from('commissions')
    .insert({
      affilie_id:          affilie.id,
      reservation_id:      resa.id,
      montant_reservation: resa.montant_total,
      taux:                affilie.taux_commission,
      montant_commission:  montantCommission,
      statut:              'en_attente',
    })
    .select('id')
    .single();

  if (errComm) {
    console.error('[commission] insert :', errComm.message);
    return;
  }

  console.log(`[commission] ${montantCommission / 100}€ pour ${affilieCode} (resa ${resa.id})`);

  // 4. Virement Stripe automatique si l'affilié a connecté son compte
  if (affilie.stripe_onboarded && affilie.stripe_account_id) {
    try {
      // On a besoin du charge ID pour lier le virement à la transaction source
      let sourceTransaction;
      if (session.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
        sourceTransaction = pi.latest_charge;
      }

      const transfer = await stripe.transfers.create({
        amount:      montantCommission,
        currency:    'eur',
        destination: affilie.stripe_account_id,
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
        metadata: {
          commission_id:  commission.id,
          reservation_id: resa.id,
          affilie_code:   affilieCode,
        },
      });

      // 5. Marquer la commission comme versée
      await supabaseAdmin
        .from('commissions')
        .update({
          statut:             'verse',
          stripe_transfer_id: transfer.id,
          paid_at:            new Date().toISOString(),
        })
        .eq('id', commission.id);

      console.log(`[commission] Virement ${transfer.id} créé (${montantCommission / 100}€ → ${affilieCode})`);

    } catch (stripeErr) {
      // Le virement a échoué → la commission reste "en_attente", à réessayer depuis l'admin
      console.error('[commission] virement Stripe :', stripeErr.message);
    }
  } else {
    // Pas de compte Stripe connecté → commission en attente de règlement manuel
    console.log(`[commission] ${affilieCode} pas encore onboardé — commission en attente`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  let event;

  // ----------------- Vérifier la signature Stripe -----------------
  try {
    const corpsBrut = await lireCorpsBrut(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(
      corpsBrut,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook] Signature invalide :', err.message);
    return res.status(400).json({ error: `Signature invalide : ${err.message}` });
  }

  // ----------------- Traiter l'événement -----------------
  try {
    switch (event.type) {

      // ---- Paiement réussi ----
      case 'checkout.session.completed': {
        const session = event.data.object;
        const reservationId = session.metadata?.reservation_id
          || session.client_reference_id;

        if (!reservationId) {
          console.warn('[webhook] session sans reservation_id');
          break;
        }

        // Marquer la résa "confirmee" (idempotent : seulement si "en_attente")
        const { data: resa, error } = await supabaseAdmin
          .from('reservations')
          .update({
            statut: 'confirmee',
            confirmed_at: new Date().toISOString(),
            stripe_payment_id: session.payment_intent,
          })
          .eq('id', reservationId)
          .eq('statut', 'en_attente')
          .select('*, salles(nom), formules(nom)')
          .single();

        if (error) {
          console.error('[webhook] échec confirmation résa :', error);
          break;
        }

        if (resa) {
          console.log(`[webhook] Réservation ${reservationId} confirmée.`);

          // Envoyer les emails en parallèle, sans bloquer le webhook
          const taches = [
            envoyerEmailConfirmation(resa)
              .catch(e => console.error('[webhook] email client :', e.message)),
            envoyerEmailNotificationAdmin(resa)
              .catch(e => console.error('[webhook] email admin :', e.message)),
          ];
          await Promise.allSettled(taches);

          // ---- Commission affilié ----
          const affilieCode = resa.affilie_code || session.metadata?.affilie_code;
          if (affilieCode) {
            traiterCommission({ affilieCode, resa, session })
              .catch(e => console.error('[webhook] commission :', e.message));
          }
        }
        break;
      }

      // ---- Session expirée ----
      case 'checkout.session.expired': {
        const session = event.data.object;
        const reservationId = session.metadata?.reservation_id
          || session.client_reference_id;
        if (reservationId) {
          await supabaseAdmin
            .from('reservations')
            .update({ statut: 'expiree' })
            .eq('id', reservationId)
            .eq('statut', 'en_attente');
          console.log(`[webhook] Réservation ${reservationId} expirée.`);
        }
        break;
      }

      default:
        break;
    }

    return res.status(200).json({ recu: true });
  } catch (err) {
    console.error('[webhook] erreur traitement :', err);
    return res.status(500).json({ error: 'Erreur webhook' });
  }
}
