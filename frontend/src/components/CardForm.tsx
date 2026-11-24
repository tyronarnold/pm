import { useContext, useState, type FormEvent } from "react";
import { BoardPeopleContext } from "@/components/BoardPeople";
import { parseLabels, priorities, type CardFields, type Priority } from "@/lib/kanban";

type CardFormProps = {
  initial: CardFields;
  submitLabel: string;
  onSubmit: (fields: CardFields) => void;
  onCancel: () => void;
};

export const emptyCard: CardFields = {
  title: "",
  details: "",
  priority: null,
  dueDate: null,
  labels: [],
  assignee: null,
};

const inputClass =
  "w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm outline-none transition focus:border-[var(--primary-blue)]";

// Title (required), details, priority, due date, labels (comma separated) and assignee of a card.
export const CardForm = ({ initial, submitLabel, onSubmit, onCancel }: CardFormProps) => {
  const [title, setTitle] = useState(initial.title);
  const [details, setDetails] = useState(initial.details);
  const [priority, setPriority] = useState<Priority | "">(initial.priority ?? "");
  const [dueDate, setDueDate] = useState(initial.dueDate ?? "");
  const [labels, setLabels] = useState(initial.labels.join(", "));
  const [assignee, setAssignee] = useState(initial.assignee ?? "");
  const { people } = useContext(BoardPeopleContext);
  // Someone who has lost access stays selectable while their card is edited, so it is not lost.
  const choices = initial.assignee && !people.includes(initial.assignee) ? [...people, initial.assignee] : people;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onSubmit({
      title: title.trim(),
      details: details.trim(),
      priority: priority || null,
      dueDate: dueDate || null,
      labels: parseLabels(labels),
      assignee: assignee || null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Card title"
        aria-label="Card title"
        className={`${inputClass} font-medium text-[var(--navy-dark)]`}
        required
      />
      <textarea
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="Details"
        aria-label="Card details"
        rows={3}
        className={`${inputClass} resize-none text-[var(--card-text)]`}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority | "")}
          aria-label="Priority"
          className={`${inputClass} text-[var(--card-text)]`}
        >
          <option value="">No priority</option>
          {priorities.map((value) => (
            <option key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          aria-label="Due date"
          className={`${inputClass} text-[var(--card-text)]`}
        />
      </div>
      <input
        value={labels}
        onChange={(event) => setLabels(event.target.value)}
        placeholder="Labels, comma separated"
        aria-label="Labels"
        className={`${inputClass} text-[var(--card-text)]`}
      />
      <select
        value={assignee}
        onChange={(event) => setAssignee(event.target.value)}
        aria-label="Assignee"
        className={`${inputClass} text-[var(--card-text)]`}
      >
        <option value="">Unassigned</option>
        {choices.map((person) => (
          <option key={person} value={person}>
            {person}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--card-text)] transition hover:text-[var(--navy-dark)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
