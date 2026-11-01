import {
  Search,
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Download,
  Users,
  Grid2X2,
  Globe,
  Crosshair,
  X,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  CalendarDays,
  Timer,
  Trophy,
  Goal,
  Activity,
  Shield,
  CircleDot,
  SlidersHorizontal,
  FileJson,
  Check,
  Eye,
  CircleHelp,
} from "lucide-react";
const icons = {
  search: Search,
  arrow: ArrowRight,
  external: ArrowUpRight,
  back: ArrowLeft,
  download: Download,
  players: Users,
  pitch: Grid2X2,
  globe: Globe,
  target: Crosshair,
  close: X,
  chevron: ChevronDown,
  right: ChevronRight,
  reset: RotateCcw,
  calendar: CalendarDays,
  timer: Timer,
  trophy: Trophy,
  goal: Goal,
  activity: Activity,
  shield: Shield,
  ball: CircleDot,
  filters: SlidersHorizontal,
  json: FileJson,
  check: Check,
  eye: Eye,
  info: CircleHelp,
};
export default function Icon({ name, className = "" }) {
  const Component = icons[name] || CircleDot;
  return (
    <Component
      className={`icon ${className}`}
      strokeWidth={1.7}
      aria-hidden="true"
    />
  );
}
