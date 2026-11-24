import { useContext } from "react";
import { BoardPeopleContext } from "@/components/BoardPeople";
import { hasFilters, noFilters, priorities, UNASSIGNED, type Filters, type Priority } from "@/lib/kanban";

type BoardFiltersProps = {
  filters: Filters;
  labels: string[]; // every label on the board
  onChange: (filters: Filters) => void;
};

const fieldClass =
  "rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

// Search and filters for the cards shown on the board.
export const BoardFilters = ({ filters, labels, onChange }: BoardFiltersProps) => {
  const { people, username } = useContext(BoardPeopleContext);
  return (
  <div role="search" aria-label="Filter cards" className="flex flex-wrap items-center gap-3">
    <input
      type="search"
      value={filters.text}
      onChange={(event) => onChange({ ...filters, text: event.target.value })}
      placeholder="Search cards"
      aria-label="Search cards"
      className={`${fieldClass} min-w-[220px] flex-1 sm:flex-none`}
    />
    <select
      value={filters.priority}
      onChange={(event) => onChange({ ...filters, priority: event.target.value as Priority | "" })}
      aria-label="Filter by priority"
      className={fieldClass}
    >
      <option value="">Any priority</option>
      {priorities.map((priority) => (
        <option key={priority} value={priority}>
          {priority[0].toUpperCase() + priority.slice(1)}
        </option>
      ))}
    </select>
    {labels.length > 0 && (
      <select
        value={filters.label}
        onChange={(event) => onChange({ ...filters, label: event.target.value })}
        aria-label="Filter by label"
        className={fieldClass}
      >
        <option value="">Any label</option>
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
    )}
    <select
      value={filters.assignee}
      onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
      aria-label="Filter by assignee"
      className={fieldClass}
    >
      <option value="">Anyone</option>
      {people.map((person) => (
        <option key={person} value={person}>
          {person === username ? `${person} (me)` : person}
        </option>
      ))}
      <option value={UNASSIGNED}>Unassigned</option>
    </select>
    {hasFilters(filters) && (
      <button
        type="button"
        onClick={() => onChange(noFilters)}
        className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--primary-blue)] transition hover:text-[var(--navy-dark)]"
      >
        Clear filters
      </button>
    )}
  </div>
);
};
