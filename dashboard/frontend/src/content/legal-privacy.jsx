// /confidentialite: the text of the privacy page. Edit by hand: one entry per section, in reading order; the
// page (src/views/LegalPage.jsx) numbers them and builds the Sommaire from `id` and `title`.
// Inside a body: <p>, <ul>/<li>, <strong>, links, <LegalTable> and <LegalField> (src/components/Legal.jsx).
// PHASE 1: the bodies below are placeholders, one sentence each; the reviewed text replaces them.
import { Cloud, Shield, Trash2, UserRound } from "lucide-react";
import { LegalField, LegalTable } from "../components/Legal.jsx";

export const privacy = {
  path: "/confidentialite",
  title: "Confidentialité",
  description:
    "Les données que Vega Sport traite, avec ou sans compte, la connexion avec Google, les prestataires, les cookies, les durées de conservation et vos droits.",
  updated: "2026-11-24",
  sibling: {
    path: "/conditions-utilisation/",
    title: "Conditions d’utilisation",
  },
  // « En bref »: three or four facts under the banner, each pointing to its section.
  facts: [
    {
      icon: UserRound,
      label: "Sans compte",
      value: "Aucune donnée personnelle demandée",
      section: "sans-compte",
    },
    {
      icon: Shield,
      label: "Avec un compte",
      value: "Votre adresse e-mail et vos préférences",
      section: "avec-un-compte",
    },
    {
      icon: Cloud,
      label: "Hébergement",
      value: "Prestataires listés au point 6",
      section: "hebergement",
    },
    {
      icon: Trash2,
      label: "Suppression",
      value: "Depuis « Mon compte », à tout moment",
      section: "supprimer",
    },
  ],
  sections: [
    {
      id: "responsable",
      title: "Qui est responsable",
      body: (
        <p>
          Le site est édité par <LegalField name="publisherName" />, responsable
          des traitements décrits sur cette page.
        </p>
      ),
    },
    {
      id: "sans-compte",
      title: "Sans compte",
      body: (
        <p>
          Le site se consulte sans compte ; cette section décrira ce qui est
          traité lors d’une simple visite.
        </p>
      ),
    },
    {
      id: "avec-un-compte",
      title: "Avec un compte",
      body: (
        <p>
          Cette section décrira les données conservées pour un compte et à quoi
          elles servent.
        </p>
      ),
    },
    {
      id: "google",
      title: "Connexion avec Google",
      body: (
        <p>
          Cette section décrira les informations reçues de Google lors de la
          connexion et leur usage.
        </p>
      ),
    },
    {
      id: "e-mails",
      title: "E-mails",
      body: (
        <p>
          Cette section décrira les e-mails envoyés par le service et leur
          fréquence.
        </p>
      ),
    },
    {
      id: "hebergement",
      title: "Hébergement et prestataires",
      body: (
        <>
          <p>
            Les prestataires qui hébergent le site et ses données sont les
            suivants.
          </p>
          <LegalTable
            caption="Prestataires"
            columns={["Prestataire", "Rôle", "Lieu"]}
            rows={[
              ["Vercel", "Hébergement du site", "Exemple à confirmer"],
              ["Neon", "Base de données des comptes", "Exemple à confirmer"],
              [
                "Amazon Web Services",
                "Données de football et API",
                "Exemple à confirmer",
              ],
            ]}
          />
        </>
      ),
    },
    {
      id: "cookies",
      title: "Cookies et stockage du navigateur",
      body: (
        <>
          <p>
            Le site enregistre quelques éléments dans votre navigateur, listés
            ci-dessous.
          </p>
          <LegalTable
            caption="Cookies et stockage local"
            columns={["Nom", "Finalité", "Durée"]}
            rows={[
              [
                "statarena.theme",
                "Mémoriser le thème clair ou sombre",
                "Exemple à confirmer",
              ],
              [
                "Cookie de session",
                "Garder la connexion au compte",
                "Exemple à confirmer",
              ],
            ]}
          />
        </>
      ),
    },
    {
      id: "conservation",
      title: "Durées de conservation",
      body: (
        <p>
          Cette section indiquera combien de temps chaque donnée est conservée.
        </p>
      ),
    },
    {
      id: "supprimer",
      title: "Supprimer votre compte",
      body: (
        <p>
          Cette section décrira comment supprimer le compte et ce qui est alors
          effacé.
        </p>
      ),
    },
    {
      id: "droits",
      title: "Vos droits",
      body: (
        <p>
          Cette section décrira vos droits sur vos données et la façon de les
          exercer.
        </p>
      ),
    },
    {
      id: "football",
      title: "Joueurs et personnes du football",
      body: (
        <p>
          Cette section décrira le traitement des données publiques des joueurs
          et des personnes du football.
        </p>
      ),
    },
    {
      id: "evolution",
      title: "Évolution de cette page",
      body: (
        <p>
          Cette section indiquera comment les changements de cette page sont
          annoncés.
        </p>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      body: (
        <p>
          Pour toute question sur vos données :{" "}
          <LegalField name="contactEmail" />.
        </p>
      ),
    },
  ],
};
