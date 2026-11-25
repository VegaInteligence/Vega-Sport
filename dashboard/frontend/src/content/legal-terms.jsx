// /conditions-utilisation: the text of the terms of service (reviewed text of 24 November 2026). Edit by hand: one
// entry per section, in reading order; the page (src/views/LegalPage.jsx) numbers them and builds the Sommaire
// from `id` and `short` (or `title`). Write ordinary apostrophes and spaces: the page sets the French typography.
// Inside a body: <p>, <ul>/<li>, <strong>, links, <LegalTable>, <LegalField> and <Ref to="id" /> (Legal.jsx).
import Link from "next/link";
import { BadgeEuro, Info, UserRound } from "lucide-react";
import { LegalField } from "../components/Legal.jsx";

export const terms = {
  path: "/conditions-utilisation",
  title: "Conditions d’utilisation",
  description:
    "Les conditions d'utilisation de Vega Sport : le service, le compte, la gratuité, les données, notes et prévisions, les sources, la propriété intellectuelle et la responsabilité.",
  updated: "2026-11-25",
  // The other legal pages, linked in the banner.
  siblings: [
    { path: "/confidentialite/", title: "Confidentialité" },
    {
      path: "/conditions-generales-de-vente/",
      title: "Conditions générales de vente",
    },
  ],
  facts: [
    {
      icon: BadgeEuro,
      label: "Gratuit",
      value: "Tout le site est gratuit, avec ou sans compte.",
      section: "offres",
    },
    {
      icon: Info,
      label: "Informations",
      value:
        "Notes, probabilités et prévisions sont données à titre d'information, sans garantie.",
      section: "donnees",
    },
    {
      icon: UserRound,
      label: "Compte",
      value: "Facultatif, supprimable à tout moment depuis « Mon compte ».",
      section: "compte",
    },
  ],
  sections: [
    {
      id: "objet",
      title: "Objet et éditeur",
      body: (
        <>
          <p>
            Ces conditions s'appliquent au site Vega Sport (
            <a href="https://vegasport.vercel.app">
              https://vegasport.vercel.app
            </a>
            ).
          </p>
          <p>
            Le site est édité par <LegalField name="publisherName" />
            <LegalField name="publisherAddress" before=", " />. Contact :{" "}
            <LegalField name="contactEmail" />.
          </p>
          <p>
            En utilisant le site, vous acceptez ces conditions. La façon dont
            vos données sont traitées est décrite dans la page «{" "}
            <Link href="/confidentialite">Confidentialité</Link> ».
          </p>
        </>
      ),
    },
    {
      id: "service",
      title: "Le service",
      body: (
        <>
          <p>
            Vega Sport propose gratuitement des statistiques, des analyses, des
            notes et des prévisions sur le football : matchs, joueurs, clubs,
            sélections et compétitions.
          </p>
          <p>
            Le site est en évolution. Des fonctions, des pages ou des données
            peuvent être ajoutées, modifiées ou retirées.
          </p>
        </>
      ),
    },
    {
      id: "compte",
      title: "Le compte",
      body: (
        <>
          <p>
            Le compte est facultatif. Il permet de retrouver vos préférences et
            vos listes sur tous vos appareils.
          </p>
          <ul>
            <li>
              Vous créez un compte avec une adresse e-mail et un mot de passe,
              ou avec Google.
            </li>
            <li>Un compte correspond à une seule personne.</li>
            <li>
              Vous gardez votre mot de passe pour vous. Si vous pensez qu'il est
              connu d'un autre, changez-le avec « Mot de passe oublié ».
            </li>
            <li>
              Vous pouvez exporter vos données et supprimer votre compte à tout
              moment, depuis « Mon compte ».
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "offres",
      title: "Offres payantes",
      body: (
        <>
          <p>
            Aucune offre payante n'est proposée aujourd'hui : tout le site est
            gratuit, avec ou sans compte.
          </p>
          <p>
            Quand des abonnements payants seront ouverts, ils seront régis par
            les «{" "}
            <Link href="/conditions-generales-de-vente">
              Conditions générales de vente
            </Link>{" "}
            », présentées et acceptées avant tout paiement.
          </p>
        </>
      ),
    },
    {
      id: "donnees",
      title: "Données, notes et prévisions",
      body: (
        <>
          <p>
            Les statistiques, les notes (par exemple la Note Vega ou le Score
            Vega), les classements, les probabilités et les prévisions sont
            fournis à titre d'information.
          </p>
          <ul>
            <li>
              Ils sont calculés à partir de données de fournisseurs tiers et de
              modèles statistiques. Ils peuvent contenir des erreurs, des
              retards ou des manques.
            </li>
            <li>
              Une probabilité n'est pas une certitude : un match peut finir
              autrement que prévu.
            </li>
            <li>
              Ce ne sont pas des conseils de paris. Le site ne prend aucun pari
              et ne garantit aucun résultat.
            </li>
            <li>
              Avant certains matchs, le site peut afficher les cotes de
              bookmakers agréés en France, à côté des cotes calculées par Vega.
              C'est une information, pas une incitation à parier. Jouer comporte
              des risques : endettement, isolement, dépendance. Pour être aidé,
              appelez le{" "}
              <a href="tel:+33974751313">09&nbsp;74&nbsp;75&nbsp;13&nbsp;13</a>{" "}
              (appel non surtaxé). Interdit aux moins de 18 ans.
            </li>
          </ul>
          <p>
            Vous restez seul responsable des décisions que vous prenez à partir
            de ces informations.
          </p>
        </>
      ),
    },
    {
      id: "sources",
      title: "Sources des données et crédits",
      short: "Sources et crédits",
      body: (
        <>
          <p>
            Les données football, les images et les cartes viennent notamment de
            :
          </p>
          <ul className="legal-sources">
            <li>PitchAPI</li>
            <li>Transfermarkt</li>
            <li>football-data.co.uk</li>
            <li>UEFA et FIFA (données publiées)</li>
            <li>SportScore (« Powered by SportScore »)</li>
            <li>OpenLigaDB — ODbL</li>
            <li>
              schochastics/football-data (World Club Ratings) — ODC-BY 1.0
            </li>
            <li>
              engsoccerdata (James P. Curley) — GPL-2.0 ou ultérieure, usage non
              commercial avec mention de la source
            </li>
            <li>open-matchday — usage non commercial avec attribution</li>
            <li>
              The Fjelstul World Cup Database (© 2023 Joshua C. Fjelstul) — CC
              BY-SA 4.0
            </li>
            <li>Wikipédia (palmarès) — CC BY-SA</li>
            <li>
              Wikimedia Commons (photos) — licence propre à chaque fichier ;
              images des trophées adaptées de photos sous CC BY et CC BY-SA
            </li>
            <li>OpenFootball, footballcsv, International Results — CC0</li>
            <li>Wikidata — CC0</li>
            <li>OpenStreetMap — ODbL ; fond de carte OpenFreeMap</li>
            <li>flag-icons (drapeaux) — MIT</li>
          </ul>
          <p>Chaque source garde ses propres droits et sa propre licence.</p>
        </>
      ),
    },
    {
      id: "propriete",
      title: "Propriété intellectuelle",
      body: (
        <>
          <p>
            Les textes, les visuels, les calculs et les méthodes propres à Vega
            Sport appartiennent à leur éditeur.
          </p>
          <p>
            Les noms, marques, blasons et logos des clubs, des compétitions et
            des fédérations, ainsi que les photos des joueurs, appartiennent à
            leurs titulaires. Ils servent seulement à identifier les équipes et
            les personnes.
          </p>
          <p>
            Une reprise du contenu au-delà de ce que la loi autorise demande
            l'accord de l'éditeur et, le cas échéant, des titulaires des droits.
          </p>
          <p>
            Ces règles ne limitent pas les usages que la loi autorise, ni les
            droits que donnent les licences libres des sources.
          </p>
        </>
      ),
    },
    {
      id: "utilisation",
      title: "Utilisation acceptable",
      body: (
        <>
          <p>En utilisant le site, vous vous engagez à ne pas :</p>
          <ul>
            <li>
              collecter ses données de façon automatique et massive, au point de
              gêner son fonctionnement ;
            </li>
            <li>
              revendre ou republier ses données comme un service concurrent ;
            </li>
            <li>
              tenter d'accéder à ce qui ne vous est pas destiné, d'attaquer le
              site ou de contourner ses protections ;
            </li>
            <li>utiliser le compte d'une autre personne.</li>
          </ul>
          <p>En cas d'abus, l'accès au site peut être limité.</p>
        </>
      ),
    },
    {
      id: "responsabilite",
      title: "Disponibilité et responsabilité",
      body: (
        <>
          <p>
            Le site est fourni tel qu'il est. Il peut être interrompu, notamment
            pour maintenance ou en cas de panne d'un prestataire.
          </p>
          <p>
            L'éditeur fait de son mieux pour que les informations soient exactes
            et le site disponible, sans pouvoir le garantir. Il n'est pas
            responsable des sites externes vers lesquels le site renvoie.
          </p>
          <p>
            Rien dans ces conditions ne vous prive des droits que la loi vous
            garantit et auxquels elle ne permet pas de renoncer.
          </p>
        </>
      ),
    },
    {
      id: "modifications",
      title: "Modifications des conditions",
      body: (
        <p>
          Ces conditions peuvent évoluer avec le site. La date en haut de page
          indique la version en vigueur.
        </p>
      ),
    },
    {
      id: "droit",
      title: "Droit applicable",
      body: (
        <p>
          <LegalField name="applicableLaw" />
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          Pour toute question sur ces conditions :{" "}
          <LegalField name="contactEmail" />.
        </p>
      ),
    },
  ],
};
