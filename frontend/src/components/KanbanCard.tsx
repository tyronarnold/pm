import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { CardForm } from "@/components/CardForm";
import type { Card, CardFields } from "@/lib/kanban";

type KanbanCardProps = {
  card: Card;
  color: string;
  overdue: boolean;
  onDelete: (cardId: string) => void;
  onEdit: (cardId: string, fields: CardFields) => void;
};

export const cardClassName =
  "rounded-2xl border-l-4 border-transparent px-6 py-5 shadow-[0_4px_12px_rgba(3,33,71,0.06)]";

const pillClass = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold";

const formatDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00`).toLocaleDateString("en-US", { dateStyle: "medium" });

// Priority, due date and labels, when the card has them.
export const CardMeta = ({ card, overdue }: { card: Card; overdue: boolean }) => {
  if (!card.priority && !card.dueDate && card.labels.length === 0) {
    return null;
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {card.priority && (
        <span className={clsx(pillClass, "bg-white/70 uppercase tracking-wide text-[var(--navy-dark)]")}>
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: `var(--priority-${card.priority})` }}
          />
          {card.priority} priority
        </span>
      )}
      {card.dueDate && (
        <span
          className={clsx(
            pillClass,
            overdue ? "bg-[var(--logout)] text-white" : "bg-white/70 text-[var(--card-text)]"
          )}
        >
          {overdue ? "Overdue" : "Due"} {formatDate(card.dueDate)}
        </span>
      )}
      {card.labels.map((label) => (
        <span key={label} className={clsx(pillClass, "bg-[var(--navy-dark)]/10 text-[var(--navy-dark)]")}>
          {label}
        </span>
      ))}
    </div>
  );
};

export const KanbanCard = ({ card, color, overdue, onDelete, onEdit }: KanbanCardProps) => {
  const [isEditing, setIsEditing] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: isEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: color,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={clsx(
        cardClassName,
        "group relative transition-[border-color,box-shadow,opacity] duration-150 hover:border-l-[var(--accent-yellow)]",
        isDragging && "opacity-60 shadow-[0_18px_32px_rgba(3,33,71,0.16)]"
      )}
      {...(isEditing ? {} : attributes)}
      {...listeners}
      data-testid={`card-${card.id}`}
    >
      {isEditing ? (
        <CardForm
          initial={card}
          submitLabel="Save"
          onSubmit={(fields) => {
            onEdit(card.id, fields);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <>
          <h4 className="pr-12 text-base font-semibold leading-6 text-[var(--navy-dark)]">
            {card.title}
          </h4>
          {card.details && (
            <p className="mt-2 text-sm leading-6 text-[var(--card-text)]">{card.details}</p>
          )}
          <CardMeta card={card} overdue={overdue} />
          {/* Shown on hover / keyboard focus where hover exists; always shown on touch screens. */}
          <div className="absolute right-3 top-4 flex items-center transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-full p-1.5 text-[var(--card-text)] transition hover:bg-white/60 hover:text-[var(--navy-dark)]"
              aria-label={`Edit ${card.title}`}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onDelete(card.id)}
              className="rounded-full p-1.5 text-[var(--card-text)] transition hover:bg-white/60 hover:text-[var(--navy-dark)]"
              aria-label={`Delete ${card.title}`}
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </>
      )}
    </article>
  );
};
