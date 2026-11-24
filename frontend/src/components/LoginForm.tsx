import { useState, type FormEvent } from "react";
import { ACCOUNT_RULES } from "@/lib/api";

type Submit = (username: string, password: string) => Promise<string | null>;

type LoginFormProps = {
  // Each resolves to null on success, or the message to show.
  onLogin: Submit;
  onRegister: Submit;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-[var(--stroke)] bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

// Signs in, or creates an account ("Create an account" switches the form).
export const LoginForm = ({ onLogin, onRegister }: LoginFormProps) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setError((await (isRegistering ? onRegister : onLogin)(username, password)) ?? "");
  };

  const switchMode = () => {
    setIsRegistering((registering) => !registering);
    setError("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)]"
      >
        <div>
          <div className="h-2 w-10 rounded-full bg-[var(--accent-yellow)]" />
          <h1 className="mt-4 font-display text-3xl font-semibold text-[var(--navy-dark)]">
            Kanban Studio
          </h1>
          <p className="mt-2 text-sm text-[var(--gray-text)]">
            {isRegistering ? "Create an account to start planning." : "Sign in to see your boards."}
          </p>
        </div>
        <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className={inputClass}
            required
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={isRegistering ? "new-password" : "current-password"}
            className={inputClass}
            required
          />
        </label>
        {isRegistering && <p className="text-xs leading-5 text-[var(--gray-text)]">{ACCOUNT_RULES}</p>}
        {error && (
          <p role="alert" className="text-sm font-medium text-[var(--secondary-purple)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          {isRegistering ? "Create account" : "Sign in"}
        </button>
        <p className="text-center text-sm text-[var(--gray-text)]">
          {isRegistering ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            onClick={switchMode}
            className="font-semibold text-[var(--primary-blue)] hover:text-[var(--navy-dark)]"
          >
            {isRegistering ? "Sign in" : "Create an account"}
          </button>
        </p>
      </form>
    </main>
  );
};
