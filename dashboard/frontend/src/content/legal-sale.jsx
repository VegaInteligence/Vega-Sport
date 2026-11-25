// /conditions-generales-de-vente: the sales terms of the paid subscriptions (Plus and Pro, by the month or by the
// year, paid with Stripe), for consumers, under French law (text of 25 November 2026). No paid offer is open yet: the
// page says so, and the prices, the SIRET, the VAT status and the mediator are owner fields (legal-identity.js
// `legalSale`) until they are decided. Edit by hand: one entry per section, in reading order; the page
// (src/views/LegalPage.jsx) numbers them and builds the Sommaire from `id` and `short` (or `title`). Write ordinary
// apostrophes and spaces: the page sets the French typography (Legal.jsx).
// Inside a body: <p>, <ul>/<li>, <strong>, links, <LegalTable>, <LegalField> and <Ref to="id" />, which writes
// « section N » with the number of that section.
import Link from "next/link";
import { CalendarX2, CreditCard, Hourglass, Undo2 } from "lucide-react";
import { LegalField, LegalTable, legalRefs } from "../components/Legal.jsx";

const Ref = legalRefs(() => sale.sections);
const Name = () => <LegalField name="publisherName" />;
const Address = () => <LegalField name="publisherAddress" before=", " />;
const Email = () => <LegalField name="contactEmail" />;

export const sale = {
  path: "/conditions-generales-de-vente",
  title: "Conditions générales de vente",
  description:
    "Les conditions de vente des abonnements Vega Sport : offres et prix, souscription, paiement avec Stripe, renouvellement, résiliation, droit de rétractation, garanties et médiation.",
  updated: "2026-11-25",
  intro:
    "Ces conditions régissent la vente des abonnements payants de Vega Sport, au mois ou à l'année.",
  // The other legal pages, linked in the banner.
  siblings: [
    { path: "/conditions-utilisation/", title: "Conditions d'utilisation" },
    { path: "/confidentialite/", title: "Confidentialité" },
  ],
  // The page also waits for the sales facts (legalSale) before it drops the « Version provisoire » line.
  saleFields: true,
  // « En bref »: each fact points to the section it sums up.
  facts: [
    {
      icon: Hourglass,
      label: "Pas encore ouvert",
      value: "Aucun abonnement payant n'est proposé aujourd'hui.",
      section: "objet",
    },
    {
      icon: CalendarX2,
      label: "Sans engagement",
      value: "Résiliable à tout moment depuis « Mon compte ».",
      section: "resiliation",
    },
    {
      icon: Undo2,
      label: "14 jours",
      value: "Pour changer d'avis après la souscription, sans motif.",
      section: "retractation",
    },
    {
      icon: CreditCard,
      label: "Paiement",
      value: "Par carte, avec Stripe, à chaque échéance.",
      section: "paiement",
    },
  ],
  sections: [
    {
      id: "objet",
      title: "Objet et champ d'application",
      short: "Objet",
      body: (
        <>
          <p>
            Ces conditions générales de vente (« CGV ») régissent la vente des
            abonnements payants du site Vega Sport (
            <a href="https://vegasport.vercel.app">
              https://vegasport.vercel.app
            </a>
            ), édité par <Name /> (voir la <Ref to="vendeur" />
            ), à des consommateurs, c'est-à-dire des personnes qui agissent à
            des fins personnelles.
          </p>
          <p>
            <strong>
              Aucun abonnement payant n'est proposé aujourd'hui : tout le site
              est gratuit.
            </strong>{" "}
            Ces conditions s'appliqueront aux abonnements souscrits à partir de
            leur ouverture.
          </p>
          <p>
            Elles complètent les «{" "}
            <Link href="/conditions-utilisation">Conditions d'utilisation</Link>{" "}
            », qui s'appliquent à tout le site, avec ou sans abonnement. Pour
            un abonnement, ces CGV l'emportent en cas de contradiction.
          </p>
          <p>
            Vous les acceptez au moment de la souscription. La version en
            vigueur ce jour-là vous est envoyée par e-mail avec la confirmation
            de votre abonnement : vous pouvez la conserver et l'imprimer.
          </p>
        </>
      ),
    },
    {
      id: "vendeur",
      title: "Le vendeur",
      body: (
        <>
          <p>
            Les abonnements sont vendus par <Name />
            <Address />.
          </p>
          <ul>
            <li>
              SIRET : <LegalField name="companyId" />.
            </li>
            <li>
              TVA : <LegalField name="vatStatus" />.
            </li>
            <li>
              Contact : <Email />.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "offres",
      title: "Les offres",
      body: (
        <>
          <p>
            Vega Sport propose une offre gratuite et des abonnements payants.
            Les offres ouvertes à un moment donné, et le détail des fonctions de
            chacune, sont présentés avant la souscription.
          </p>
          <LegalTable
            caption="Les offres et leurs prix"
            columns={["Offre", "Ce qu'elle comprend", "Au mois", "À l'année"]}
            nowrap={[2, 3]}
            rows={[
              [
                "Gratuit",
                "Les statistiques, notes et prévisions ouvertes à tous, avec ou sans compte.",
                "0 €",
                "0 €",
              ],
              [
                "Plus",
                "Les fonctions de Gratuit, et les fonctions réservées à Plus.",
                <LegalField key="pm" name="pricePlusMonthly" />,
                <LegalField key="py" name="pricePlusYearly" />,
              ],
              [
                "Pro",
                "Les fonctions de Plus, et les fonctions réservées à Pro.",
                <LegalField key="rm" name="priceProMonthly" />,
                <LegalField key="ry" name="priceProYearly" />,
              ],
            ]}
          />
          <p>
            Le site évolue : des fonctions peuvent être ajoutées ou améliorées.
            Si une modification réduit de façon plus que mineure ce que
            comprend votre abonnement, vous êtes prévenu par e-mail à l'avance,
            et vous pouvez résilier sans frais dans les 30 jours suivant ce
            message ou la modification, si elle est plus tardive. La part de
            l'abonnement déjà payée et non utilisée vous est alors remboursée.
          </p>
        </>
      ),
    },
    {
      id: "prix",
      title: "Prix",
      body: (
        <>
          <p>
            Les prix sont indiqués en euros, toutes taxes comprises, dans le
            tableau de la <Ref to="offres" /> et avant la souscription. Le prix
            payé est celui affiché au moment de la souscription ; il reste le
            même pendant toute la période en cours.
          </p>
          <p>
            Un nouveau prix ne s'applique qu'au renouvellement suivant. Vous en
            êtes prévenu par e-mail au moins un mois avant ce renouvellement.
            Si vous ne l'acceptez pas, vous pouvez résilier avant cette date,
            sans frais (<Ref to="resiliation" />
            ).
          </p>
        </>
      ),
    },
    {
      id: "souscription",
      title: "Souscription",
      body: (
        <>
          <p>
            Pour souscrire, il faut un compte Vega Sport et être majeur. Les
            étapes sont les suivantes :
          </p>
          <ul>
            <li>vous choisissez l'offre et la durée, au mois ou à l'année ;</li>
            <li>
              un récapitulatif vous montre l'offre, son prix, sa durée et son
              renouvellement automatique, et vous permet de corriger votre
              choix ;
            </li>
            <li>
              vous acceptez ces CGV et vous demandez l'accès immédiat à l'offre
              (voir la <Ref to="retractation" />
              ) ;
            </li>
            <li>
              vous validez avec le bouton « Payer et s'abonner », qui vous
              engage à payer.
            </li>
          </ul>
          <p>
            Le contrat est conclu quand le paiement est accepté. Une
            confirmation vous est alors envoyée par e-mail, avec ces CGV.
          </p>
        </>
      ),
    },
    {
      id: "paiement",
      title: "Paiement",
      body: (
        <>
          <p>
            Le paiement se fait par carte bancaire, ou par un autre moyen
            proposé sur la page de paiement, avec Stripe, un prestataire de
            paiement agréé. Les coordonnées de votre carte sont saisies chez
            Stripe : l'éditeur ne les voit pas et ne les conserve pas.
          </p>
          <ul>
            <li>
              Le prix est débité à la souscription, puis au début de chaque
              nouvelle période, mois ou année.
            </li>
            <li>Une facture vous est envoyée par e-mail à chaque paiement.</li>
            <li>
              Si un paiement échoue, il est tenté de nouveau pendant quelques
              jours et vous êtes prévenu par e-mail. Sans paiement, l'abonnement
              prend fin et votre compte revient à l'offre Gratuit, sans perte de
              vos préférences ni de vos listes.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "essai",
      title: "Essai gratuit",
      body: (
        <>
          <p>
            Une offre peut commencer par un essai gratuit. Sa durée et ses
            conditions sont indiquées avant de le commencer, et rien n'est
            débité pendant l'essai.
          </p>
          <ul>
            <li>
              Un essai sans carte bancaire prend fin seul : aucun abonnement ne
              commence sans que vous le demandiez.
            </li>
            <li>
              Si une carte est demandée, vous êtes prévenu par e-mail avant la
              fin de l'essai. Sans résiliation de votre part avant cette fin,
              l'abonnement payant commence et le premier paiement est débité.
            </li>
            <li>Un seul essai par personne et par offre.</li>
          </ul>
        </>
      ),
    },
    {
      id: "duree",
      title: "Durée et renouvellement",
      short: "Renouvellement",
      body: (
        <>
          <p>
            Un abonnement est souscrit pour un mois ou pour un an, à partir de
            la date de souscription. À la fin de chaque période, il est
            renouvelé automatiquement pour la même durée, sauf si vous l'avez
            résilié avant.
          </p>
          <ul>
            <li>
              La date du prochain renouvellement est toujours indiquée dans «
              Mon compte ».
            </li>
            <li>
              Pour un abonnement annuel, un e-mail vous rappelle cette date et
              votre droit de ne pas renouveler, entre trois mois et un mois
              avant le renouvellement.
            </li>
            <li>
              Si ce rappel ne vous a pas été envoyé, vous pouvez résilier à
              tout moment après le renouvellement, sans frais : la part payée
              pour la période qui suit la résiliation vous est remboursée sous
              30 jours (article L215-1 du code de la consommation).
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "resiliation",
      title: "Résiliation",
      body: (
        <>
          <p>
            Vous pouvez résilier votre abonnement à tout moment, depuis « Mon
            compte », avec le bouton « Résilier l'abonnement », en quelques
            clics. Une confirmation vous est envoyée par e-mail.
          </p>
          <ul>
            <li>
              La résiliation prend effet à la fin de la période déjà payée :
              vous gardez l'accès à votre offre jusqu'à cette date, puis votre
              compte revient à l'offre Gratuit.
            </li>
            <li>
              La période commencée n'est pas remboursée, sauf dans les cas
              prévus par ces CGV ou par la loi (rétractation, défaut de
              conformité, modification de l'offre, rappel de renouvellement
              manquant).
            </li>
            <li>
              Supprimer votre compte résilie aussi votre abonnement.
            </li>
          </ul>
          <p>
            L'éditeur peut résilier un abonnement en cas de manquement grave
            aux «{" "}
            <Link href="/conditions-utilisation">Conditions d'utilisation</Link>{" "}
            » (par exemple le partage d'un compte ou une fraude), après une
            mise en demeure par e-mail restée sans effet pendant 15 jours, sauf
            en cas de fraude. S'il arrête le service, il vous prévient au moins
            un mois à l'avance et rembourse la part payée et non utilisée.
          </p>
        </>
      ),
    },
    {
      id: "retractation",
      title: "Droit de rétractation",
      body: (
        <>
          <p>
            Vous disposez de 14 jours à partir de la souscription pour vous
            rétracter, sans donner de motif et sans frais autres que ceux
            indiqués ci-dessous.
          </p>
          <ul>
            <li>
              Pour vous rétracter, envoyez avant la fin de ce délai une
              déclaration claire par e-mail à <Email />, par exemple avec le
              modèle de la <Ref to="formulaire" />.
            </li>
            <li>
              Vous êtes remboursé au plus tard 14 jours après l'envoi de votre
              déclaration, avec le moyen de paiement utilisé pour la
              souscription, sans frais.
            </li>
            <li>
              Comme vous avez demandé à accéder à l'offre dès la souscription,
              avant la fin du délai, le montant qui correspond au service
              fourni jusqu'à votre déclaration, calculé au prorata, reste dû
              (article L221-25 du code de la consommation). Le reste vous est
              remboursé.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "conformite",
      title: "Garantie légale de conformité",
      short: "Garantie de conformité",
      body: (
        <>
          <p>
            Pendant toute la durée de votre abonnement, l'éditeur répond des
            défauts de conformité du service, au titre de la garantie légale de
            conformité des contenus et services numériques (articles L224-25-12
            et suivants du code de la consommation).
          </p>
          <ul>
            <li>
              Si une fonction de votre offre ne marche pas comme prévu,
              signalez-le à <Email />.
            </li>
            <li>
              Le défaut est corrigé dans un délai raisonnable, sans frais pour
              vous.
            </li>
            <li>
              S'il ne peut pas l'être, ou pas dans ce délai, vous pouvez obtenir
              une réduction du prix ou, si le défaut n'est pas mineur, mettre
              fin à l'abonnement et être remboursé de la période concernée.
            </li>
          </ul>
          <p>
            Une prévision qui ne se réalise pas n'est pas un défaut de
            conformité : les notes et les prévisions sont des informations,
            sans garantie de résultat.
          </p>
        </>
      ),
    },
    {
      id: "responsabilite",
      title: "Responsabilité",
      body: (
        <>
          <p>
            L'éditeur est responsable de la bonne exécution de votre
            abonnement. Il ne l'est pas quand un problème vient de vous, du
            fait imprévisible et insurmontable d'un tiers, ou d'un cas de force
            majeure.
          </p>
          <p>
            Un abonnement donne accès à des fonctions, pas à un résultat. Les
            statistiques, notes, probabilités et prévisions restent fournies à
            titre d'information et ne sont pas des conseils de paris, comme le
            disent les «{" "}
            <Link href="/conditions-utilisation">Conditions d'utilisation</Link>{" "}
            ».
          </p>
          <p>
            Rien dans ces CGV ne vous prive des droits que la loi vous garantit
            et auxquels elle ne permet pas de renoncer.
          </p>
        </>
      ),
    },
    {
      id: "donnees",
      title: "Données personnelles",
      body: (
        <>
          <p>
            Pour un abonnement, l'éditeur traite en plus de votre compte :
            l'offre choisie, ses dates, l'état des paiements, les factures et
            votre identifiant de client chez Stripe. Stripe traite vos
            coordonnées de paiement pour exécuter les paiements et lutter
            contre la fraude.
          </p>
          <p>
            Les factures sont conservées dix ans, comme la loi l'impose. Vos
            autres données et vos droits sont décrits dans la page «{" "}
            <Link href="/confidentialite">Confidentialité</Link> ».
          </p>
        </>
      ),
    },
    {
      id: "reclamations",
      title: "Service client et réclamations",
      short: "Réclamations",
      body: (
        <p>
          Pour toute question ou réclamation sur un abonnement, écrivez à{" "}
          <Email />. Si la réponse ne vous satisfait pas, vous pouvez recourir
          à la médiation (<Ref to="mediation" />
          ).
        </p>
      ),
    },
    {
      id: "mediation",
      title: "Médiation de la consommation",
      short: "Médiation",
      body: (
        <>
          <p>
            Si un litige n'est pas réglé après une réclamation écrite auprès de
            l'éditeur, vous pouvez saisir gratuitement le médiateur de la
            consommation : <LegalField name="mediator" />.
          </p>
          <p>
            Vous devez le saisir au plus tard un an après votre réclamation
            écrite. Le recours à la médiation est libre : vous pouvez aussi
            vous adresser directement au tribunal.
          </p>
        </>
      ),
    },
    {
      id: "modifications",
      title: "Modification des CGV",
      body: (
        <p>
          Ces CGV peuvent évoluer. Une nouvelle version s'applique aux
          nouvelles souscriptions dès sa mise en ligne. Pour un abonnement en
          cours, elle ne s'applique qu'au renouvellement suivant, après un
          e-mail envoyé au moins un mois avant : si vous ne l'acceptez pas,
          vous pouvez résilier avant cette date, sans frais.
        </p>
      ),
    },
    {
      id: "droit",
      title: "Droit applicable et litiges",
      short: "Droit applicable",
      body: (
        <>
          <p>
            Ces CGV sont soumises au droit français. Si vous résidez dans un
            autre pays de l'Union européenne, vous gardez la protection des
            règles impératives de ce pays.
          </p>
          <p>
            En cas de litige, vous pouvez saisir le tribunal du lieu où vous
            habitiez au moment de la souscription ou au moment du fait qui vous
            a causé un dommage, ou tout autre tribunal compétent selon la loi.
          </p>
        </>
      ),
    },
    {
      id: "formulaire",
      title: "Modèle de formulaire de rétractation",
      short: "Formulaire de rétractation",
      body: (
        <>
          <p>
            Remplissez et envoyez ce formulaire uniquement si vous souhaitez
            vous rétracter du contrat.
          </p>
          <p>
            À l'attention de <Name />
            <Address />, <Email /> :
          </p>
          <p>
            Je vous notifie par la présente ma rétractation du contrat portant
            sur la prestation de services ci-dessous :
          </p>
          <ul>
            <li>Abonnement (offre, au mois ou à l'année) :</li>
            <li>Souscrit le :</li>
            <li>Nom du consommateur :</li>
            <li>Adresse e-mail du compte :</li>
            <li>
              Signature du consommateur (uniquement en cas d'envoi sur papier) :
            </li>
            <li>Date :</li>
          </ul>
        </>
      ),
    },
  ],
};
