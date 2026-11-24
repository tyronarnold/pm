import { useEffect, useState, type FormEvent } from "react";
import { addMember, listMembers, removeMember } from "@/lib/api";

type SharePanelProps = {
  boardId: number;
  owner: string;
  username: string; // the signed-in user
  onLeave: () => void;
  onClose: () => void;
};

const ACTION_FAILED = "That did not work. Check that the server is running and try again.";

const smallButtonClass =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]";

// Who a board is shared with. The owner adds and removes members; a member can leave.
export const SharePanel = ({ boardId, owner, username, onLeave, onClose }: SharePanelProps) => {
  const [members, setMembers] = useState<string[] | null>(null);
  const [newMember, setNewMember] = useState("");
  const [message, setMessage] = useState("");
  const isOwner = owner === username;

  useEffect(() => {
    listMembers(boardId).then(setMembers, () => setMessage(ACTION_FAILED));
  }, [boardId]);

  const handleShare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newMember.trim();
    if (!name) {
      return;
    }
    const error = await addMember(boardId, name);
    setMessage(error ?? "");
    if (!error) {
      setNewMember("");
      setMembers(await listMembers(boardId));
    }
  };

  const handleRemove = async (member: string) => {
    try {
      await removeMember(boardId, member);
      setMembers(await listMembers(boardId));
      setMessage("");
    } catch {
      setMessage(ACTION_FAILED);
    }
  };

  const handleLeave = async () => {
    if (!window.confirm("Leave this board? You will need the owner to share it again.")) {
      return;
    }
    try {
      await removeMember(boardId, username);
      onLeave();
    } catch {
      setMessage(ACTION_FAILED);
    }
  };

  return (
    <section
      aria-label="Sharing"
      className="flex flex-col gap-5 rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-8 shadow-[var(--shadow)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Sharing</h2>
          <p className="mt-1 text-sm text-[var(--gray-text)]">
            Members can see and edit this board and use the AI assistant on it. Only the owner can
            rename, delete or share it.
          </p>
        </div>
        <button type="button" onClick={onClose} className={smallButtonClass}>
          Close
        </button>
      </div>

      <ul aria-label="People with access" className="flex flex-col gap-2">
        <li className="flex items-center justify-between gap-3 text-sm text-[var(--navy-dark)]">
          <span>
            <span className="font-semibold">{owner}</span>{" "}
            <span className="text-[var(--gray-text)]">(owner)</span>
          </span>
        </li>
        {members?.map((member) => (
          <li key={member} className="flex items-center justify-between gap-3 text-sm text-[var(--navy-dark)]">
            <span className="font-semibold">{member}</span>
            {isOwner && (
              <button
                type="button"
                onClick={() => handleRemove(member)}
                className={smallButtonClass}
                aria-label={`Remove ${member}`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {members?.length === 0 && (
          <li className="text-sm text-[var(--gray-text)]">Not shared with anyone yet.</li>
        )}
      </ul>

      {isOwner ? (
        <form onSubmit={handleShare} className="flex flex-wrap items-center gap-3">
          <input
            value={newMember}
            onChange={(event) => setNewMember(event.target.value)}
            placeholder="Username"
            aria-label="Share with (username)"
            className="min-w-[220px] rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
            required
          />
          <button
            type="submit"
            className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
          >
            Share
          </button>
        </form>
      ) : (
        <div>
          <button
            type="button"
            onClick={handleLeave}
            className="rounded-full bg-[var(--logout)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
          >
            Leave board
          </button>
        </div>
      )}

      {message && (
        <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
          {message}
        </p>
      )}
    </section>
  );
};
