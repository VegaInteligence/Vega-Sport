import { useFootball } from "../hooks/FootballContext.jsx";
import Icon from "./Icon.jsx";
export default function CompetitionScope() {
  const f = useFootball();
  return (
    <button
      type="button"
      className="competition-scope-button"
      aria-pressed={f.focus === "europe"}
      onClick={() => f.changeFocus(f.focus === "europe" ? "all" : "europe")}
    >
      <Icon name="trophy" />
      Top 7 Europe + UEFA{f.focus === "europe" && <Icon name="check" />}
    </button>
  );
}
