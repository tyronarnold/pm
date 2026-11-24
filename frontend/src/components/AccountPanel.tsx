import { useState, type FormEvent } from "react";
import { changePassword, deleteAccount } from "@/lib/api";

type AccountPanelProps = {
  onClose: () => void;
  onDeleted: () => void;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";
const labelClass = "block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]";

export const AccountPanel = ({ onClose, onDeleted }: AccountPanelProps) => {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = await changePassword(current, next);
    setPasswordMessage(error ?? "Your password has been changed.");
    if (!error) {
      setCurrent("");
      setNext("");
    }
  };

  const handleDelete = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.confirm("Delete your account and all your boards? This cannot be undone.")) {
      return;
    }
    const error = await deleteAccount(deletePassword);
    if (error) {
      setDeleteError(error);
    } else {
      onDeleted();
    }
  };

  return (
    <section
      aria-label="Account settings"
      className="grid gap-8 rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-8 shadow-[var(--shadow)] md:grid-cols-2"
    >
      <form onSubmit={handleChangePassword} className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Change password</h2>
        <label className={labelClass}>
          Current password
          <input
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            className={inputClass}
            required
          />
        </label>
        <label className={labelClass}>
          New password
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            className={inputClass}
            required
          />
        </label>
        <p className="text-xs text-[var(--gray-text)]">At least 8 characters.</p>
        {passwordMessage && (
          <p role="status" className="text-sm font-medium text-[var(--secondary-purple)]">
            {passwordMessage}
          </p>
        )}
        <button
          type="submit"
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Change password
        </button>
      </form>

      <form onSubmit={handleDelete} className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Delete account</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
          >
            Close
          </button>
        </div>
        <p className="text-sm text-[var(--gray-text)]">
          Deletes your account and every board in it. This cannot be undone.
        </p>
        <label className={labelClass}>
          Password
          <input
            type="password"
            value={deletePassword}
            onChange={(event) => setDeletePassword(event.target.value)}
            autoComplete="current-password"
            className={inputClass}
            required
          />
        </label>
        {deleteError && (
          <p role="alert" className="text-sm font-medium text-[var(--secondary-purple)]">
            {deleteError}
          </p>
        )}
        <button
          type="submit"
          className="rounded-full bg-[var(--logout)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Delete account
        </button>
      </form>
    </section>
  );
};
