import { createContext } from "react";

// The people on the open board (owner first, then members) and the signed-in user.
// KanbanBoard provides it; the card form, card details and filters read it.
export const BoardPeopleContext = createContext<{ people: string[]; username: string }>({
  people: [],
  username: "",
});
