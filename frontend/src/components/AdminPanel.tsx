import { useEffect, useState, type FormEvent } from "react";
import { deleteUser, listUsers, resetPassword, setAdmin, type UserInfo } from "@/lib/api";

type AdminPanelProps = {
  username: string; // the signed-in admin
  onClose: () => void;
};

const LOAD_FAILED = "Could not load the users. Check that the server is running.";

const smallButtonClass =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]";

const formatDate = (timestamp: string) =>
  new Date(`${timestamp.replace(" ", "T")}Z`).toLocaleDateString("en-US", { dateStyle: "medium" });

// Every user, with their role and board count. Admins change roles, reset passwords and delete users.
export const AdminPanel = ({ username, onClose }: AdminPanelProps) => {
  const [users, setUsers] = useState<UserInfo[] | null>(null);
  const [message, setMessage] = useState("");
  const [resetting, setResetting] = useState<string | null>(null); // whose password is being reset
  const [newPassword, setNewPassword] = useState("");

  const reload = async () => {
    try {
      setUsers(await listUsers());
    } catch {
      setMessage(LOAD_FAILED);
    }
  };

  useEffect(() => {
    listUsers().then(setUsers, () => setMessage(LOAD_FAILED));
  }, []);

  // Runs an action that resolves to null or an error message, then reloads the list.
  const run = async (action: Promise<string | null>, done: string) => {
    const error = await action;
    setMessage(error ?? done);
    if (!error) {
      await reload();
    }
  };

  const handleDelete = (user: string) => {
    if (window.confirm(`Delete ${user} and all their boards? This cannot be undone.`)) {
      void run(deleteUser(user), `${user} has been deleted.`);
    }
  };

  const handleReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const user = resetting!;
    await run(resetPassword(user, newPassword), `${user}'s password has been reset; they are signed out.`);
    setResetting(null);
    setNewPassword("");
  };

  return (
    <section
      aria-label="Users"
      className="flex flex-col gap-5 rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-8 shadow-[var(--shadow)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Users</h2>
          <p className="mt-1 text-sm text-[var(--gray-text)]">
            Admins can manage every account. There is always at least one admin.
          </p>
        </div>
        <button type="button" onClick={onClose} className={smallButtonClass}>
          Close
        </button>
      </div>

      {users && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.2em] text-[var(--gray-text)]">
              <tr>
                <th className="py-2 pr-4 font-semibold">User</th>
                <th className="py-2 pr-4 font-semibold">Role</th>
                <th className="py-2 pr-4 font-semibold">Boards</th>
                <th className="py-2 pr-4 font-semibold">Joined</th>
                <th className="py-2 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.username} className="border-t border-[var(--stroke)] text-[var(--navy-dark)]">
                  <td className="py-3 pr-4 font-semibold">
                    {user.username}
                    {user.username === username && (
                      <span className="font-normal text-[var(--gray-text)]"> (you)</span>
                    )}
                  </td>
                  <td className="py-3 pr-4">{user.is_admin ? "Admin" : "Member"}</td>
                  <td className="py-3 pr-4">{user.boards}</td>
                  <td className="py-3 pr-4">{formatDate(user.created_at)}</td>
                  <td className="py-3">
                    {resetting === user.username ? (
                      <form onSubmit={handleReset} className="flex flex-wrap items-center gap-2">
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          aria-label={`New password for ${user.username}`}
                          autoComplete="new-password"
                          autoFocus
                          className="rounded-full border border-[var(--stroke)] bg-white px-3 py-1 text-sm outline-none focus:border-[var(--primary-blue)]"
                          required
                        />
                        <button type="submit" className={smallButtonClass}>
                          Set password
                        </button>
                        <button type="button" onClick={() => setResetting(null)} className={smallButtonClass}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            run(
                              setAdmin(user.username, !user.is_admin),
                              `${user.username} is ${user.is_admin ? "no longer an admin" : "now an admin"}.`
                            )
                          }
                          className={smallButtonClass}
                          aria-label={`${user.is_admin ? "Remove admin from" : "Make admin"} ${user.username}`}
                        >
                          {user.is_admin ? "Remove admin" : "Make admin"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetting(user.username)}
                          className={smallButtonClass}
                          aria-label={`Reset password for ${user.username}`}
                        >
                          Reset password
                        </button>
                        {user.username !== username && (
                          <button
                            type="button"
                            onClick={() => handleDelete(user.username)}
                            className={smallButtonClass}
                            aria-label={`Delete ${user.username}`}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {message && (
        <p role="status" className="text-sm font-semibold text-[var(--secondary-purple)]">
          {message}
        </p>
      )}
    </section>
  );
};
