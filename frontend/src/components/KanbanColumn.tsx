import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { isOverdue, type Card, type CardFields, type Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[]; // the cards that match the filters
  filtering: boolean;
  color: string; // card background
  isFirst: boolean;
  // Cards in the last column are finished, so they are never shown as overdue.
  isLast: boolean;
  today: string;
  onRename: (columnId: string, title: string) => void;
  onRenameDone: () => void;
  onAddCard: (columnId: string, fields: CardFields) => void;
  onDeleteCard: (cardId: string) => void;
  onEditCard: (cardId: string, fields: CardFields) => void;
  onMove: (columnId: string, offset: number) => void;
  onDelete: (columnId: string) => void;
};

const iconButtonClass =
  "rounded-full p-1 text-[var(--gray-text)] transition hover:bg-[var(--badge)] hover:text-[var(--navy-dark)] disabled:opacity-30 disabled:hover:bg-transparent";

export const KanbanColumn = ({
  column,
  cards,
  filtering,
  color,
  isFirst,
  isLast,
  today,
  onRename,
  onRenameDone,
  onAddCard,
  onDeleteCard,
  onEditCard,
  onMove,
  onDelete,
}: KanbanColumnProps) => {
  const name = column.title || "untitled";
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "group/column flex min-h-[520px] flex-col rounded-3xl lg:min-w-[240px] lg:flex-1 border border-t-4 border-[var(--stroke)] border-t-[var(--accent-yellow)] bg-[var(--column-surface)] p-4 shadow-[0_8px_24px_rgba(3,33,71,0.06)] transition",
        isOver && "ring-2 ring-[var(--primary-blue)]"
      )}
      data-testid={`column-${column.id}`}
    >
      <div className="flex items-center justify-between gap-3 px-2 pt-2">
        <input
          value={column.title}
          onChange={(event) => onRename(column.id, event.target.value)}
          onBlur={onRenameDone}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 bg-transparent text-base font-bold uppercase tracking-wide text-[var(--navy-dark)] outline-none"
          aria-label="Column title"
        />
        <span
          className="rounded-full bg-[var(--badge)] px-2.5 py-0.5 text-xs font-semibold text-[var(--gray-text)]"
          aria-label={
            filtering ? `${cards.length} of ${column.cardIds.length} cards` : `${cards.length} cards`
          }
        >
          {filtering ? `${cards.length}/${column.cardIds.length}` : cards.length}
        </span>
      </div>
      {/* Shown on hover / keyboard focus where hover exists; always shown on touch screens. */}
      <div className="flex justify-end gap-1 px-1 pt-2 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/column:opacity-100 pointer-fine:group-focus-within/column:opacity-100">
        <button
          type="button"
          onClick={() => onMove(column.id, -1)}
          disabled={isFirst}
          className={iconButtonClass}
          aria-label={`Move ${name} column left`}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 5l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onMove(column.id, 1)}
          disabled={isLast}
          className={iconButtonClass}
          aria-label={`Move ${name} column right`}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onDelete(column.id)}
          disabled={column.cardIds.length > 0}
          title={column.cardIds.length > 0 ? "Move or delete its cards first" : undefined}
          className={iconButtonClass}
          aria-label={`Delete ${name} column`}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-4">
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              color={color}
              overdue={!isLast && isOverdue(card, today)}
              onDelete={onDeleteCard}
              onEdit={onEditCard}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--badge)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            {filtering && column.cardIds.length > 0 ? "No matching cards" : "Drop a card here"}
          </div>
        )}
      </div>
      <NewCardForm
        onAdd={(fields) => onAddCard(column.id, fields)}
      />
    </section>
  );
};
