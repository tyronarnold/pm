import { useState, type FormEvent } from "react";

type NewColumnFormProps = {
  onAdd: (title: string) => void;
};

// "+ Add column" tile after the last column; opens a title form.
export const NewColumnForm = ({ onAdd }: NewColumnFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");

  const close = () => {
    setTitle("");
    setIsOpen(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onAdd(title.trim());
    close();
  };

  return (
    <div className="lg:w-[220px] lg:shrink-0">
      {isOpen ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-3xl border border-dashed border-[var(--stroke)] bg-[var(--column-surface)] p-4"
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Column title"
            aria-label="New column title"
            autoFocus
            className="w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
            required
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
            >
              Add column
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-[var(--stroke)] px-5 py-6 text-sm font-semibold text-[var(--gray-text)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
        >
          <span aria-hidden="true" className="text-xl leading-none">+</span>
          Add column
        </button>
      )}
    </div>
  );
};
