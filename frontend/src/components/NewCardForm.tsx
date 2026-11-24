import { useState } from "react";
import { CardForm, emptyCard } from "@/components/CardForm";
import type { CardFields } from "@/lib/kanban";

type NewCardFormProps = {
  onAdd: (fields: CardFields) => void;
};

// Full-width "+ Add card" button that opens the card form.
export const NewCardForm = ({ onAdd }: NewCardFormProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-4">
      {isOpen ? (
        <CardForm
          initial={emptyCard}
          submitLabel="Add card"
          onSubmit={(fields) => {
            onAdd(fields);
            setIsOpen(false);
          }}
          onCancel={() => setIsOpen(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex w-full items-center gap-3 rounded-xl bg-[var(--add-card)] px-5 py-3 text-base font-medium text-[var(--navy-dark)] transition hover:brightness-105"
        >
          <span aria-hidden="true" className="text-xl leading-none">+</span>
          Add card
        </button>
      )}
    </div>
  );
};
