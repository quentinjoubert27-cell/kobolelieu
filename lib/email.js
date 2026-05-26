// ============================================================================
// lib/email.js — Envoi d'emails via Resend
// ============================================================================
// Deux fonctions :
//  - envoyerEmailConfirmation(resa)  → email beau au CLIENT
//  - envoyerEmailNotificationAdmin(resa) → notification "nouvelle résa" À TOI
// ============================================================================

import { Resend } from 'resend';
import { formatEuros } from './clients.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const EXPEDITEUR = process.env.EMAIL_FROM
  || 'Kōbō Le Lieu <reservation@kobo-bdx.com>';

const EMAIL_ADMIN = process.env.EMAIL_ADMIN
  || 'hello@kobo-bdx.com';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function dateLisible(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
function creneauLisible(hDebut, hFin) {
  return `${String(hDebut).padStart(2,'0')}h00 — ${String(hFin).padStart(2,'0')}h00`;
}


// ============================================================================
// 1) EMAIL CLIENT — confirmation de réservation
// ============================================================================
export async function envoyerEmailConfirmation(resa) {
  const nomSalle = resa.salles?.nom || 'votre salle';
  const nomFormule = resa.formules?.nom || '';
  const date = dateLisible(resa.date_resa);
  const creneau = creneauLisible(resa.heure_debut, resa.heure_fin);
  const duree = resa.heure_fin - resa.heure_debut;

  const html = `
  <!doctype html>
  <html lang="fr">
  <body style="margin:0;padding:0;background:#faf3e3;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf3e3;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:2px solid #1a1612;border-radius:16px;overflow:hidden;">

          <tr>
            <td style="background:#01357b;padding:32px 40px;">
              <div style="font-size:28px;font-weight:bold;color:#faf3e3;">Kōbō Le Lieu</div>
              <div style="font-size:13px;color:#f4c542;letter-spacing:1px;margin-top:4px;">RÉSERVATION CONFIRMÉE</div>
            </td>
          </tr>

          <tr>
            <td style="padding:40px;">
              <p style="font-size:17px;color:#1a1612;margin:0 0 8px;">Bonjour ${resa.client_nom},</p>
              <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 28px;">
                Votre paiement a bien été reçu, votre salle est réservée. Voici le récapitulatif&nbsp;:
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#eef2fa;border:2px dashed #01357b;border-radius:12px;">
                <tr><td style="padding:24px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr><td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Salle</td></tr>
                    <tr><td style="font-size:22px;color:#01357b;font-weight:bold;padding-bottom:16px;">${nomSalle}</td></tr>

                    ${nomFormule ? `
                      <tr><td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Formule</td></tr>
                      <tr><td style="font-size:16px;color:#1a1612;padding-bottom:16px;">${nomFormule}</td></tr>
                    ` : ''}

                    <tr><td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Date</td></tr>
                    <tr><td style="font-size:16px;color:#1a1612;padding-bottom:16px;">${date}</td></tr>

                    <tr><td style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Créneau</td></tr>
                    <tr><td style="font-size:16px;color:#1a1612;padding-bottom:16px;">${creneau} &nbsp;·&nbsp; ${duree}h</td></tr>

                    <tr>
                      <td style="border-top:1px solid #c9d4e8;padding-top:16px;font-size:14px;color:#444;">
                        Montant réglé&nbsp;:
                        <strong style="font-size:20px;color:#01357b;">${formatEuros(resa.montant_total)}</strong>
                      </td>
                    </tr>
                  </table>
                </td></tr>
              </table>

              <p style="font-size:14px;color:#444;line-height:1.6;margin:28px 0 8px;">
                <strong>Adresse</strong><br>
                76 rue Mandron, 33000 Bordeaux — quartier des Chartrons
              </p>
              <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 8px;">
                <strong>Annulation</strong><br>
                Gratuite jusqu'à 24h avant. Pour toute question, répondez à cet email.
              </p>

              <p style="font-size:15px;color:#1a1612;margin:28px 0 0;">
                À très vite chez Kōbō&nbsp;!<br>
                <span style="color:#888;">— L'équipe Kōbō Le Lieu</span>
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1612;padding:24px 40px;">
              <div style="font-size:12px;color:#faf3e3;opacity:.7;">
                Kōbō · 76 rue Mandron, Bordeaux · kobo-bdx.com
              </div>
              <div style="font-size:11px;color:#faf3e3;opacity:.4;margin-top:6px;">
                Réf. réservation : ${resa.id}
              </div>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>
  `;

  const { data, error } = await resend.emails.send({
    from: EXPEDITEUR,
    to: resa.client_email,
    subject: `Réservation confirmée — ${nomSalle}, ${date}`,
    html,
  });

  if (error) throw new Error(error.message || 'Échec envoi email client');
  return data;
}


// ============================================================================
// 2) EMAIL ADMIN — notification d'une nouvelle réservation
// ============================================================================
export async function envoyerEmailNotificationAdmin(resa) {
  const nomSalle = resa.salles?.nom || '—';
  const nomFormule = resa.formules?.nom || '—';
  const date = dateLisible(resa.date_resa);
  const creneau = creneauLisible(resa.heure_debut, resa.heure_fin);
  const duree = resa.heure_fin - resa.heure_debut;
  const adminUrl = (process.env.SITE_URL || 'https://kobo-bdx.com')
    + '/admin.html?token=' + (process.env.ADMIN_TOKEN || '');

  const html = `
  <!doctype html>
  <html lang="fr">
  <body style="margin:0;padding:0;background:#faf3e3;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf3e3;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:2px solid #1a1612;border-radius:16px;overflow:hidden;">

          <tr>
            <td style="background:#4a7c3a;padding:24px 32px;">
              <div style="font-size:11px;color:#faf3e3;letter-spacing:2px;opacity:.8;">NOUVELLE RÉSERVATION</div>
              <div style="font-size:26px;font-weight:bold;color:#faf3e3;margin-top:4px;">Une salle vient d'être réservée 🎉</div>
            </td>
          </tr>

          <tr>
            <td style="padding:32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="font-size:13px;color:#888;padding-bottom:4px;text-transform:uppercase;letter-spacing:1px;">Client</td>
                </tr>
                <tr>
                  <td style="font-size:18px;font-weight:bold;color:#1a1612;padding-bottom:4px;">${resa.client_nom}</td>
                </tr>
                <tr>
                  <td style="font-size:14px;color:#444;padding-bottom:6px;">
                    ${resa.client_email}
                    ${resa.client_tel ? ` · ${resa.client_tel}` : ''}
                    ${resa.client_entreprise ? `<br><span style="color:#888">${resa.client_entreprise}</span>` : ''}
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#eef2fa;border-radius:10px;">
                <tr><td style="padding:18px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:50%;padding-bottom:10px;">
                        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Salle</div>
                        <div style="font-size:16px;font-weight:bold;color:#01357b;">${nomSalle}</div>
                      </td>
                      <td style="width:50%;padding-bottom:10px;">
                        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Formule</div>
                        <div style="font-size:16px;color:#1a1612;">${nomFormule}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-bottom:10px;">
                        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Date</div>
                        <div style="font-size:15px;color:#1a1612;">${date}</div>
                      </td>
                      <td style="padding-bottom:10px;">
                        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Créneau</div>
                        <div style="font-size:15px;color:#1a1612;">${creneau} (${duree}h)</div>
                      </td>
                    </tr>
                    ${resa.nb_participants ? `
                    <tr>
                      <td colspan="2" style="padding-bottom:10px;">
                        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Participants</div>
                        <div style="font-size:15px;color:#1a1612;">${resa.nb_participants} personnes</div>
                      </td>
                    </tr>` : ''}
                    <tr>
                      <td colspan="2" style="border-top:1px solid #c9d4e8;padding-top:12px;font-size:14px;color:#444;">
                        Montant réglé&nbsp;:
                        <strong style="font-size:20px;color:#4a7c3a;">${formatEuros(resa.montant_total)}</strong>
                      </td>
                    </tr>
                  </table>
                </td></tr>
              </table>

              ${resa.message ? `
              <div style="margin-top:20px;padding:14px 16px;background:#fef9e7;border-left:3px solid #f4c542;border-radius:6px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Message du client</div>
                <div style="font-size:14px;color:#1a1612;line-height:1.5;">${resa.message}</div>
              </div>` : ''}

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr><td align="center">
                  <a href="${adminUrl}"
                     style="display:inline-block;padding:14px 28px;background:#01357b;color:#faf3e3;border-radius:999px;text-decoration:none;font-weight:bold;font-size:14px;">
                    Voir dans le planning →
                  </a>
                </td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#1a1612;padding:18px 32px;">
              <div style="font-size:11px;color:#faf3e3;opacity:.5;">Réf : ${resa.id}</div>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>
  `;

  const { data, error } = await resend.emails.send({
    from: EXPEDITEUR,
    to: EMAIL_ADMIN,
    subject: `Nouvelle réservation : ${nomSalle} — ${date}`,
    html,
  });

  if (error) throw new Error(error.message || 'Échec envoi email admin');
  return data;
}


// ============================================================================
// 3) EMAIL CLIENT — annulation par l'admin
// ============================================================================
export async function envoyerEmailAnnulation(resa) {
  const nomSalle = resa.salles?.nom || 'votre salle';
  const date = dateLisible(resa.date_resa);
  const creneau = creneauLisible(resa.heure_debut, resa.heure_fin);

  const html = `
  <!doctype html>
  <html lang="fr">
  <body style="margin:0;padding:0;background:#faf3e3;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf3e3;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:2px solid #1a1612;border-radius:16px;overflow:hidden;">

          <tr>
            <td style="background:#e6543c;padding:32px 40px;">
              <div style="font-size:13px;color:#faf3e3;letter-spacing:1px;opacity:.85;">RÉSERVATION ANNULÉE</div>
              <div style="font-size:26px;font-weight:bold;color:#faf3e3;margin-top:4px;">Votre réservation a été annulée</div>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 40px;">
              <p style="font-size:16px;color:#1a1612;margin:0 0 14px;">Bonjour ${resa.client_nom},</p>
              <p style="font-size:15px;color:#444;line-height:1.6;margin:0 0 18px;">
                Nous vous confirmons l'annulation de votre réservation&nbsp;:
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#fef0ee;border-radius:10px;margin-bottom:24px;">
                <tr><td style="padding:18px;">
                  <div style="font-size:18px;color:#1a1612;font-weight:bold;">${nomSalle}</div>
                  <div style="font-size:14px;color:#666;margin-top:4px;">${date} · ${creneau}</div>
                </td></tr>
              </table>

              <p style="font-size:14px;color:#444;line-height:1.6;margin:0;">
                Si vous avez des questions ou souhaitez reprogrammer, répondez simplement
                à cet email. Le remboursement sera traité sous 5 jours ouvrés.
              </p>
            </td>
          </tr>

        </table>
      </td></tr>
    </table>
  </body>
  </html>
  `;

  const { data, error } = await resend.emails.send({
    from: EXPEDITEUR,
    to: resa.client_email,
    subject: `Réservation annulée — ${nomSalle}, ${date}`,
    html,
  });

  if (error) throw new Error(error.message || 'Échec envoi email annulation');
  return data;
}
