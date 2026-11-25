/** The account screens' words (VI-38, docs/COMPTES_SITE.md O5, O8, A10). Never the address a person typed. */

const UNREACHABLE = "Le service de connexion est injoignable. Réessayez dans un instant.";

/**
 * A Better Auth / Neon error → one French sentence. @neon/auth gives a normalized code (`invalid_credentials`…) and
 * status, with Better Auth's raw answer as `.error` ({ code, status }), read first; a thrown fetch error is a
 * TypeError.
 */
export function authErrorMessage(error) {
  const raw = error?.error && typeof error.error === "object" ? error.error : {};
  const code = typeof raw.code === "string" ? raw.code : typeof error?.code === "string" ? error.code : "";
  const normalized = typeof error?.code === "string" ? error.code : "";
  const status = Number(raw.status ?? error?.status) || 0;
  const is = (...codes) => codes.includes(code) || codes.includes(normalized);
  if (is("INVALID_EMAIL_OR_PASSWORD", "INVALID_PASSWORD", "USER_NOT_FOUND", "invalid_credentials", "user_not_found"))
    return "Adresse ou mot de passe incorrect.";
  if (code.startsWith("USER_ALREADY_EXISTS") || is("user_already_exists", "email_exists"))
    return "Un compte existe déjà avec cette adresse. Connectez-vous.";
  if (is("PASSWORD_TOO_SHORT", "weak_password")) return "Le mot de passe doit compter au moins 8 caractères.";
  if (is("PASSWORD_TOO_LONG")) return "Ce mot de passe est trop long.";
  if (is("INVALID_EMAIL", "email_address_invalid")) return "Cette adresse e-mail n'est pas valide.";
  if (is("EMAIL_NOT_VERIFIED", "email_not_confirmed")) return "Il faut d'abord confirmer votre adresse e-mail.";
  // The e-mail codes (section 8, R4).
  if (is("INVALID_OTP")) return "Code incorrect.";
  if (is("OTP_EXPIRED")) return "Ce code a expiré. Demandez-en un nouveau.";
  if (is("TOO_MANY_ATTEMPTS")) return "Trop d'essais. Demandez un nouveau code.";
  if (is("over_email_send_rate_limit")) return "Trop de codes demandés. Patientez une minute avant de réessayer.";
  if (is("PROVIDER_NOT_FOUND", "SOCIAL_SIGN_IN_FAILED", "oauth_provider_not_supported", "bad_oauth_callback", "oauth_callback_failed") || code.startsWith("OAUTH"))
    return "La connexion avec Google n'est pas disponible pour le moment.";
  if (status === 429 || is("over_request_rate_limit")) return "Trop de tentatives. Patientez une minute avant de réessayer.";
  if (code.startsWith("NETWORK_") || status === 502 || status === 0 || error instanceof TypeError) return UNREACHABLE;
  if (code.endsWith("ORIGIN")) return UNREACHABLE;
  return "La connexion est momentanément indisponible. Réessayez dans un instant.";
}

/**
 * The return from Google refused on the way (docs/COMPTES_SITE.md section 9, G2): one sentence; an unknown code
 * follows the generic one in parentheses so it can be reported. `code` is already clean (account-return.js).
 */
export function returnErrorMessage(code) {
  if (code === "account_not_linked")
    return "Cette adresse a déjà un compte avec un mot de passe, jamais confirmé : connectez-vous avec ce mot de passe et confirmez l'adresse d'abord.";
  if (code === "access_denied") return "La connexion avec Google a été annulée ou refusée.";
  const generic = "La connexion avec Google n'a pas abouti. Réessayez.";
  return typeof code === "string" && code ? `${generic} (${code})` : generic;
}

/** The refusal of DELETE /account (an AccountApiError) → what the person reads. */
export function deletionMessage(error) {
  switch (error?.code) {
    case "DELETION_UNAVAILABLE":
    case "SYNC_UNAVAILABLE":
      return "La suppression du compte n'est pas encore possible depuis le site. Rien n'a été effacé.";
    case "SUBSCRIPTION_ACTIVE":
      return "Un abonnement est en cours : résiliez-le avant de supprimer le compte. Rien n'a été effacé.";
    case "IDENTITY_DELETE_FAILED":
      return "Vos données Vega sont effacées, mais l'identifiant de connexion n'a pas pu l'être. Réessayez.";
    case "ACCOUNT_ERASED":
      return "Ce compte a déjà été supprimé.";
    default:
      return error?.status === 0 || error?.code === "ACCOUNT_UNREACHABLE"
        ? "Le serveur des comptes ne répond pas. Rien n'a été effacé ; réessayez."
        : "La suppression a échoué. Rien n'a été effacé ; réessayez.";
  }
}

/** The sync status of the adapter → { text, pill, detail? } for /compte: the block's words, the hero's short form. */
export function syncLabel(sync) {
  switch (sync?.state) {
    case "synced":
      return { text: "À jour", pill: "Synchronisé" };
    case "failed":
      return {
        text: "En échec",
        pill: "Synchro en échec",
        detail: [sync.reason, "Nouvel essai au prochain changement."].filter(Boolean).join(" "),
      };
    case "stopped":
      return { text: "Arrêtée", pill: "Synchro arrêtée", detail: sync.reason };
    case "unavailable":
      return { text: "Indisponible", pill: "Synchro indisponible" };
    default:
      return { text: "En cours", pill: "Synchronisation…" };
  }
}

/** The account's level (backend/account, POST /account/session) → its plan. */
export const planLabel = (level) =>
  level >= 4 ? "Fondateur" : level === 3 ? "Pro" : level === 2 ? "Plus" : "Gratuit";
