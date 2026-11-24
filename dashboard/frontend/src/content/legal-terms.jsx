// /conditions-utilisation: the text of the terms of service. Edit by hand: one entry per section, in reading
// order; the page (src/views/LegalPage.jsx) numbers them and builds the Sommaire from `id` and `title`.
// Inside a body: <p>, <ul>/<li>, <strong>, links, <LegalTable> and <LegalField> (src/components/Legal.jsx).
// PHASE 1: the bodies below are placeholders, one sentence each; the reviewed text replaces them.
import { LegalField, LegalTable } from "../components/Legal.jsx";

export const terms = {
  path: "/conditions-utilisation",
  title: "Conditions d’utilisation",
  description:
    "Les conditions d’utilisation de Vega Sport : le service, le compte, les offres, les données et pronostics, les sources, la propriété intellectuelle et la responsabilité.",
  updated: "2026-11-24",
  sibling: { path: "/confidentialite/", title: "Confidentialité" },
  facts: [],
  sections: [
    {
      id: "objet",
      title: "Objet et éditeur",
      body: (
        <p>
          Ces conditions encadrent l’usage de Vega Sport, édité par{" "}
          <LegalField name="publisherName" />,{" "}
          <LegalField name="publisherStatus" />.
        </p>
      ),
    },
    {
      id: "service",
      title: "Le service",
      body: (
        <p>
          Cette section décrira le service : statistiques, analyses et
          pronostics de football.
        </p>
      ),
    },
    {
      id: "compte",
      title: "Votre compte",
      body: (
        <p>
          Cette section décrira la création du compte, son usage et sa
          fermeture.
        </p>
      ),
    },
    {
      id: "offres",
      title: "Offres payantes",
      body: (
        <p>Cette section décrira les offres payantes, si elles existent.</p>
      ),
    },
    {
      id: "donnees",
      title: "Données, notes et pronostics",
      body: (
        <p>
          Cette section précisera la nature des données, des notes et des
          pronostics affichés.
        </p>
      ),
    },
    {
      id: "sources",
      title: "Sources et crédits",
      body: (
        <>
          <p>Les données affichées proviennent des sources suivantes.</p>
          <LegalTable
            caption="Sources"
            columns={["Source", "Usage", "Licence"]}
            rows={[
              [
                "International Results",
                "Résultats des sélections",
                "Exemple à confirmer",
              ],
              [
                "openfootball",
                "Archives des compétitions",
                "Exemple à confirmer",
              ],
            ]}
          />
        </>
      ),
    },
    {
      id: "propriete",
      title: "Propriété intellectuelle",
      body: (
        <p>
          Cette section décrira les droits sur le site, sa marque et ses
          contenus.
        </p>
      ),
    },
    {
      id: "usage",
      title: "Usage du site",
      body: (
        <p>
          Cette section listera les usages permis et ceux qui ne le sont pas.
        </p>
      ),
    },
    {
      id: "responsabilite",
      title: "Disponibilité et responsabilité",
      body: (
        <p>
          Cette section décrira la disponibilité du service et les limites de
          responsabilité.
        </p>
      ),
    },
    {
      id: "evolution",
      title: "Évolution des conditions",
      body: (
        <p>
          Cette section indiquera comment les changements de ces conditions sont
          annoncés.
        </p>
      ),
    },
    {
      id: "droit",
      title: "Droit applicable",
      body: (
        <p>
          <LegalField name="applicableLaw" />.
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
