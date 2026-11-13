
import { moods } from "../data";
import { MoodId } from "../types";

interface Props {
  selected: MoodId | null;
  onSelect: (mood: MoodId) => void;
}

export function MoodSelector({ selected, onSelect }: Props) {
  return (
    <div className="mood-editorial-list">
      {moods.map((mood, index) => (
        <button
          key={mood.id}
          type="button"
          className={`mood-editorial-item ${
            selected === mood.id ? "selected" : ""
          }`}
          onClick={() => onSelect(mood.id)}
          aria-pressed={selected === mood.id}
        >
          <span className="mood-number">
            0{index + 1}
          </span>

          <span className="mood-information">
            <strong>{mood.label}</strong>
            <small>{mood.description}</small>
          </span>

          <span className="mood-arrow">↗</span>
        </button>
      ))}
    </div>
  );
}
