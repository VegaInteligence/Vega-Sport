// What the render tests give a page in place of the edition's head (EditionHeader.jsx): its name, its editions with
// the chosen one selected, and what the page puts in it (the views, the team followed).
export function editionHeaderStub(React) {
  const h = React.createElement;
  return {
    __esModule: true,
    default: ({ name, editions = [], season, children }) =>
      h("header", null, h("h2", null, name),
        h("select", { "aria-label": "Édition", value: season, onChange() {} }, editions.map((edition) => h("option", { key: edition.season, value: edition.season }, edition.label || edition.season))),
        children),
    FollowedTeam: ({ label }) => h("button", null, label),
  };
}
