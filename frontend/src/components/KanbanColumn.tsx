import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { columnColors, type Card, type Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";

type KanbanColumnProps = {
  column: Column;
  cards: Card[];
  onRename: (columnId: string, title: string) => void;
  onRenameDone: () => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onDeleteCard: (cardId: string) => void;
  onEditCard: (cardId: string, title: string, details: string) => void;
};

export const KanbanColumn = ({
  column,
  cards,
  onRename,
  onRenameDone,
  onAddCard,
  onDeleteCard,
  onEditCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        "flex min-h-[520px] flex-col rounded-3xl border border-t-4 border-[var(--stroke)] border-t-[var(--accent-yellow)] bg-[var(--column-surface)] p-4 shadow-[0_8px_24px_rgba(3,33,71,0.06)] transition",
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
          aria-label={`${cards.length} cards`}
        >
          {cards.length}
        </span>
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-4">
        <SortableContext items={column.cardIds} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard
              key={card.id}
              card={card}
              color={columnColors[column.id]}
              onDelete={onDeleteCard}
              onEdit={onEditCard}
            />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--badge)] px-3 py-6 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
            Drop a card here
          </div>
        )}
      </div>
      <NewCardForm
        onAdd={(title, details) => onAddCard(column.id, title, details)}
      />
    </section>
  );
};
