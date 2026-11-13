
import { Home, History, UserRound } from "lucide-react";

interface Props {
  active: string;
  onChange: (tab: string) => void;
}

export function BottomNav({ active, onChange }: Props) {
  const tabs = [
    { id: "home", label: "Início", icon: Home },
    { id: "history", label: "Histórico", icon: History },
    { id: "profile", label: "Perfil", icon: UserRound },
  ];

  return (
    <nav className="bottom-nav" aria-label="Navegação principal">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            className={isActive ? "active" : ""}
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={21} strokeWidth={isActive ? 2.2 : 1.7} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
