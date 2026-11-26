import SeasonSelect from "./SeasonSelect.jsx";

export default function SeasonFilter({ f }) {
  return (
    <SeasonSelect
      controlId="season-filter"
      value={f.season}
      seasons={f.manifest.seasons.map((season) => season.id)}
      onChange={f.changeSeason}
    />
  );
}
