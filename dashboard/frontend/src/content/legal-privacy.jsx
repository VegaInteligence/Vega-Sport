// /confidentialite: the text of the privacy page (reviewed text of 24 November 2026). Edit by hand: one entry per
// section, in reading order; the page (src/views/LegalPage.jsx) numbers them and builds the Sommaire from `id` and
// `short` (or `title`). Write ordinary apostrophes and spaces: the page sets the French typography (Legal.jsx).
// Inside a body: <p>, <ul>/<li>, <strong>, <code>, links, <LegalTable>, <LegalField> and <Ref to="id" />, which
// writes « section N » with the number of that section.
import { CloudCog, Monitor, Trash2, UserRound } from "lucide-react";
import { LegalField, LegalTable, legalRefs } from "../components/Legal.jsx";

const Ref = legalRefs(() => privacy.sections);
const Name = () => <LegalField name="publisherName" />;
const Address = () => <LegalField name="publisherAddress" before=", " />;
const Email = () => <LegalField name="contactEmail" />;

export const privacy = {
  path: "/confidentialite",
  title: "Confidentialité",
  description:
    "Les données que Vega Sport traite, avec ou sans compte, la connexion avec Google, les prestataires, les cookies, la suppression du compte et vos droits.",
  updated: "2026-11-24",
  intro: (
    <>
      Cette page explique quelles données le site Vega Sport (
      <a href="https://vegasport.vercel.app">https://vegasport.vercel.app</a>)
      traite, et comment vous pouvez agir.
    </>
  ),
  sibling: {
    path: "/conditions-utilisation/",
    title: "Conditions d'utilisation",
  },
  // « En bref »: each fact points to the section it sums up.
  facts: [
    {
      icon: Monitor,
      label: "Sans compte",
      value: "Vos choix restent dans votre navigateur.",
      section: "sans-compte",
    },
    {
      icon: UserRound,
      label: "Avec un compte",
      value:
        "E-mail et mot de passe chez Neon Auth, préférences et listes chez AWS.",
      section: "avec-un-compte",
    },
    {
      icon: CloudCog,
      label: "Connexion Google",
      value:
        "Vos données Google servent uniquement à créer votre compte et à vous connecter.",
      section: "google",
    },
    {
      icon: Trash2,
      label: "Suppression",
      value: "Depuis « Mon compte », avec effet immédiat.",
      section: "supprimer",
    },
  ],
  sections: [
    {
      id: "responsable",
      title: "Qui est responsable",
      body: (
        <>
          <p>
            Le responsable des données est <Name />
            <Address />.
          </p>
          <p>
            Pour toute question sur vos données : <Email />.
          </p>
          <p>Sur quoi reposent les traitements :</p>
          <ul>
            <li>
              <strong>le compte et ses préférences</strong> : le service que
              vous demandez en créant un compte ;
            </li>
            <li>
              <strong>la mesure d'audience et de performance</strong> : votre
              consentement, lorsque vous êtes en Europe (
              <Ref to="cookies" />) ;
            </li>
            <li>
              <strong>
                les journaux techniques et la protection contre les abus
              </strong>{" "}
              : l'intérêt légitime de garder le site en état de marche et sûr.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "sans-compte",
      title: "Sans compte : ce que le site traite",
      short: "Sans compte",
      body: (
        <>
          <p>Vous pouvez utiliser tout le site sans compte. Dans ce cas :</p>
          <ul>
            <li>
              <strong>Vos choix restent dans votre navigateur</strong> (thème,
              compétitions suivies, pays, « Ma sélection », recherches :{" "}
              <Ref to="cookies" />
              ). Un cookie en reprend une partie pour afficher l'accueil
              directement avec eux.
            </li>
            <li>
              <strong>Votre pays.</strong> Pour mettre en avant les matchs de
              votre pays, le site utilise d'abord le pays que vous avez choisi
              dans « Votre pays ». Sans choix de votre part, il utilise le code
              de pays à deux lettres (par exemple « FR ») que l'hébergeur Vercel
              déduit de votre adresse IP. Le site ne lit pas l'adresse IP
              elle-même et ne demande pas votre position. Ce code reste dans
              votre navigateur ; il n'est pas enregistré sur nos serveurs. Vous
              pouvez choisir un autre pays, ou « Aucun pays ».
            </li>
            <li>
              <strong>Mesure d'audience et de performance.</strong> Le site
              utilise Vercel Web Analytics et Vercel Speed Insights. Selon la
              documentation de Vercel, ils traitent notamment les pages vues, la
              page de provenance, le pays, le type de navigateur, de système et
              d'appareil, et la vitesse d'affichage. Le site n'y ajoute ni votre
              adresse e-mail, ni votre identifiant de compte. En Europe, ces
              deux outils ne sont chargés qu'après votre accord (
              <Ref to="cookies" />
              ).
            </li>
            <li>
              <strong>Journaux techniques.</strong> Comme tout hébergeur, Vercel
              reçoit les informations techniques de chaque requête (adresse IP,
              page demandée, date, navigateur). Nos serveurs AWS gardent 14
              jours une ligne par requête, sans adresse IP ni contenu. Pour
              limiter les abus, un pare-feu AWS compte les requêtes par adresse
              IP vers notre service de données.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "avec-un-compte",
      title: "Avec un compte : ce qui s'ajoute",
      short: "Avec un compte",
      body: (
        <>
          <p>
            Créer un compte est facultatif. Il sert à retrouver vos préférences
            et vos listes sur tous vos appareils.
          </p>
          <LegalTable
            caption="Données d'un compte"
            columns={["Donnée", "Pourquoi", "Où", "Durée"]}
            nowrap={[2]}
            rows={[
              [
                "Adresse e-mail, nom (avec Google), mot de passe, confirmation de l'adresse",
                "Créer le compte, vous connecter",
                "Neon Auth",
                "Jusqu'à la suppression du compte",
              ],
              [
                "Sessions : date, navigateur utilisé, adresse IP si elle est transmise",
                "Vous garder connecté, sécuriser le compte",
                "Neon Auth",
                "Durée fixée par Neon Auth",
              ],
              [
                "Identifiant de compte, date de création, jour de la dernière connexion",
                "Relier le compte à vos préférences",
                "AWS",
                "Jusqu'à la suppression du compte",
              ],
              [
                "Préférences et listes : thème, compétitions suivies, pays choisi, favoris (clubs, sélections, joueurs, matchs), recherches et indices enregistrés, comparaison, réglages des tableaux",
                "Les retrouver sur tous vos appareils",
                "AWS",
                "Jusqu'à la suppression du compte",
              ],
            ]}
          />
          <p>
            Nos serveurs AWS ne gardent ni votre adresse e-mail, ni votre nom,
            ni votre mot de passe. Votre mot de passe n'est jamais visible par
            le site : il est traité par Neon Auth.
          </p>
          <p>
            À votre première connexion, les choix déjà faits dans ce navigateur
            sont ajoutés au compte. À la déconnexion, ils sont effacés de ce
            navigateur (sauf le thème).
          </p>
        </>
      ),
    },
    {
      id: "google",
      title: "Connexion avec Google",
      body: (
        <>
          <p>
            Si vous choisissez « Continuer avec Google », vous êtes envoyé sur
            la page de Google. Google vous y montre les informations qu'il
            partage avec Vega Sport et vous demande votre accord.
          </p>
          <p>
            Données que Neon Auth reçoit de Google et garde pour votre compte :
          </p>
          <ul>
            <li>votre nom ;</li>
            <li>votre adresse e-mail et le fait qu'elle est vérifiée ;</li>
            <li>le lien vers votre photo de profil ;</li>
            <li>votre identifiant Google ;</li>
            <li>les jetons de connexion émis par Google.</li>
          </ul>
          <p>
            Le site les utilise uniquement pour créer votre compte et vous
            connecter. « Mon compte » affiche votre nom et votre adresse e-mail,
            pas votre photo.
          </p>
          <p>Ce que le site ne fait pas avec ces données :</p>
          <ul>
            <li>
              il n'accède à aucune autre donnée de votre compte Google (e-mails,
              fichiers, contacts, agenda) ;
            </li>
            <li>
              il ne contient aucun outil publicitaire et n'utilise pas ces
              données pour de la publicité ;
            </li>
            <li>il ne les vend pas ;</li>
            <li>
              il ne les transmet à personne d'autre que les prestataires de la{" "}
              <Ref to="prestataires" />.
            </li>
          </ul>
          <p>
            Ces données sont effacées avec votre compte (<Ref to="supprimer" />
            ).
          </p>
        </>
      ),
    },
    {
      id: "e-mails",
      title: "E-mails envoyés",
      body: (
        <>
          <p>Le site envoie seulement des e-mails liés à votre compte :</p>
          <ul>
            <li>
              un code à six chiffres pour confirmer votre adresse à
              l'inscription ;
            </li>
            <li>
              un code à six chiffres si vous avez oublié votre mot de passe.
            </li>
          </ul>
          <p>
            Ces e-mails sont envoyés par Neon Auth, depuis l'adresse{" "}
            <code>auth@mail.myneon.app</code>. Le site n'envoie ni lettre
            d'information ni publicité.
          </p>
        </>
      ),
    },
    {
      id: "prestataires",
      title: "Prestataires et lieux d'hébergement",
      short: "Prestataires et hébergement",
      body: (
        <>
          <LegalTable
            caption="Prestataires"
            columns={["Prestataire", "Rôle", "Lieu"]}
            rows={[
              [
                "Vercel",
                "Hébergement et serveur du site, mesure d'audience et de performance",
                "États-Unis (Cleveland) ; diffusion mondiale",
              ],
              [
                "Neon (Neon Auth)",
                "Comptes, sessions, connexion Google, e-mails de code",
                "États-Unis (Ohio)",
              ],
              [
                "Amazon Web Services",
                "Données football, préférences des comptes, images, scores en direct, journaux",
                "États-Unis (Ohio) ; diffusion mondiale",
              ],
              [
                "Amazon Web Services",
                "Pare-feu et alertes du service de données",
                "États-Unis (Virginie)",
              ],
              ["Google", "Connexion avec Google, si vous la choisissez", "—"],
              [
                "unpkg et OpenFreeMap",
                "Carte 3D du stade, quand vous l'ouvrez sur une fiche club",
                "—",
              ],
            ]}
          />
          <p>
            Vercel, Neon et Amazon Web Services sont des entreprises
            américaines, et vos données sont traitées aux États-Unis. Chacune
            publie ses propres engagements en matière de protection des données.
          </p>
          <p>
            Les images de clubs et de joueurs viennent de nos propres serveurs.
            Seuls quelques plans officiels de stades, sur les fiches club, sont
            chargés depuis le site du club, qui applique ses propres règles.
          </p>
        </>
      ),
    },
    {
      id: "supprimer",
      title: "Supprimer votre compte",
      body: (
        <>
          <p>
            Dans « Mon compte », choisissez « Supprimer mon compte », tapez «
            SUPPRIMER », puis « Supprimer définitivement ».
          </p>
          <p>
            La suppression est immédiate. Elle efface, sur nos serveurs AWS,
            votre compte, vos préférences et vos listes, puis, chez Neon Auth,
            votre identité, vos sessions et le lien avec Google. Vous êtes
            ensuite déconnecté et les données du compte sont retirées de ce
            navigateur.
          </p>
          <p>Ce qui reste :</p>
          <ul>
            <li>
              l'identifiant technique du compte supprimé et la date de
              suppression, pour empêcher qu'un autre appareil encore connecté ne
              recrée le compte ;
            </li>
            <li>
              les copies de sauvegarde de notre base AWS, jusqu'à 7 jours ;
            </li>
            <li>
              nos journaux AWS, qui ne contiennent pas l'identifiant du compte,
              jusqu'à 14 jours ;
            </li>
            <li>
              ce que Vercel, Neon et Google gardent dans leurs propres systèmes,
              selon les règles de chaque prestataire.
            </li>
          </ul>
          <p>
            Si la suppression n'est pas disponible ou si une étape échoue, le
            site vous le dit ; vous pouvez alors recommencer plus tard.
          </p>
          <p>
            Avant de supprimer votre compte, « Exporter mes données » vous
            permet de télécharger un fichier qui contient tout ce que nos
            serveurs AWS gardent sur vous.
          </p>
        </>
      ),
    },
    {
      // The cookie banner's « Confidentialité » link points here: keep this id.
      id: "cookies",
      title: "Cookies et stockage du navigateur",
      body: (
        <>
          <p>Le site ne dépose aucun cookie publicitaire ni cookie tiers.</p>
          <LegalTable
            caption="Cookies et stockage du navigateur"
            columns={["Nom", "Type", "Contenu", "Durée"]}
            nowrap={[1]}
            rows={[
              [
                <code>vega.consent.v1</code>,
                "Stockage local",
                "Votre choix pour la mesure d'audience",
                "6 mois",
              ],
              [
                <code>vega.home.v1</code>,
                "Cookie",
                "Vos choix pour l'accueil, dont vos favoris",
                "1 an",
              ],
              [
                <code>__Secure-neon-auth.session_token</code>,
                "Cookie (compte)",
                "Votre session",
                "Fixée par Neon Auth",
              ],
              [
                <code>__Secure-neon-auth.local.session_data</code>,
                "Cookie (compte)",
                "Copie signée de la session",
                "5 minutes au plus",
              ],
              [
                <code>__Secure-neon-auth.session_challenge</code>,
                "Cookie (compte)",
                "Étape de connexion",
                "Le temps de la connexion",
              ],
              [
                <code>orion.preferences.v1</code>,
                "Stockage local",
                "Compétitions suivies, pays",
                "Jusqu'à effacement",
              ],
              [
                <code>statarena.research.v1</code>,
                "Stockage local",
                "« Ma sélection », recherches",
                "Jusqu'à effacement",
              ],
              [
                <code>statarena.theme</code>,
                "Stockage local",
                "Thème",
                "Jusqu'à effacement",
              ],
              [
                <code>statarena.preferred-competition.v1</code>,
                "Stockage local",
                "Compétition par défaut",
                "Jusqu'à effacement",
              ],
              [
                <code>statarena.visitor-country.v1</code>,
                "Stockage local",
                "Pays détecté",
                "Jusqu'à effacement",
              ],
              [
                <code>vega.account.hint.v1</code>,
                "Stockage local",
                "Session possible (rien sur vous)",
                "Jusqu'à la déconnexion",
              ],
              [
                <code>vega.account.merged.v1</code>,
                "Stockage local",
                "Comptes déjà réunis ici",
                "Jusqu'à la déconnexion",
              ],
              [
                <>
                  <code>vega.preselect.v1</code>,{" "}
                  <code>statarena:page-seasons:v1</code>,{" "}
                  <code>vega:back-labels</code>
                </>,
                "Stockage de session",
                "Filtres, saisons, pages visitées",
                "Fermeture de l'onglet",
              ],
            ]}
          />
          <p>
            <strong>Le bandeau « Cookies ».</strong> Si vous êtes en Europe, un
            bandeau vous propose « Accepter » ou « Refuser » la mesure
            d'audience et de performance. Tant que vous n'avez pas accepté,
            Vercel Web Analytics et Speed Insights ne sont pas chargés. Votre
            choix, accord ou refus, est gardé six mois dans votre navigateur,
            puis le bandeau revient. Vous pouvez changer d'avis à tout moment
            avec le lien « Cookies » en bas de page.
          </p>
          <p>
            Pour savoir si vous êtes en Europe, le site utilise la localisation
            que Vercel déduit de votre adresse IP (code de continent ou de pays
            seulement). Le site ne lit pas et ne garde pas votre adresse IP.
            Hors d'Europe, il n'y a pas de bandeau et la mesure fonctionne.
          </p>
          <p>
            Vous pouvez aussi effacer ces données à tout moment dans les
            réglages de votre navigateur.
          </p>
        </>
      ),
    },
    {
      id: "droits",
      title: "Vos droits",
      body: (
        <>
          <p>
            Lorsque le RGPD s'applique, vous pouvez demander l'accès à vos
            données, leur rectification, leur effacement, la limitation de leur
            traitement, leur portabilité, ou vous opposer à leur traitement.
            Vous pouvez retirer votre consentement à la mesure d'audience avec
            le lien « Cookies ».
          </p>
          <p>
            Vous pouvez déjà exporter et supprimer vous-même votre compte depuis
            « Mon compte ». Pour toute autre demande : <Email />.
          </p>
          <p>
            Vous pouvez aussi adresser une réclamation à l'autorité de
            protection des données. En France, c'est la CNIL (
            <a href="https://www.cnil.fr">www.cnil.fr</a>).
          </p>
        </>
      ),
    },
    {
      id: "football",
      title: "Données sur les joueurs et les acteurs du football",
      short: "Joueurs et acteurs du football",
      body: (
        <>
          <p>
            Le site publie des informations sur des joueurs et des entraîneurs :
            nom, photo, nationalité, date de naissance, taille, pied fort, club,
            carrière, contrats, valeurs marchandes, blessures et absences,
            statistiques de match, ainsi que des notes et classements calculés
            par Vega.
          </p>
          <p>
            Ces informations viennent de sources publiques et de fournisseurs de
            données football. Si une information vous concerne et vous semble
            inexacte, écrivez à <Email /> pour demander sa correction.
          </p>
        </>
      ),
    },
    {
      id: "modifications",
      title: "Modifications de cette page",
      body: (
        <p>
          Cette page sera mise à jour si le site change (nouvelle fonction,
          nouveau prestataire). La date en haut indique la version en vigueur.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          <Name />
          <Address />, <Email />.
        </p>
      ),
    },
  ],
};
