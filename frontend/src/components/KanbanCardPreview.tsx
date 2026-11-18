import clsx from "clsx";
import { cardClassName } from "@/components/KanbanCard";
import type { Card } from "@/lib/kanban";

type KanbanCardPreviewProps = {
  card: Card;
  color: string;
};

export const KanbanCardPreview = ({ card, color }: KanbanCardPreviewProps) => (
  <article
    className={clsx(cardClassName, "border-l-[var(--accent-yellow)] shadow-[0_18px_32px_rgba(3,33,71,0.16)]")}
    style={{ backgroundColor: color }}
  >
    <h4 className="text-base font-semibold leading-6 text-[var(--navy-dark)]">{card.title}</h4>
    {card.details && (
      <p className="mt-2 text-sm leading-6 text-[var(--card-text)]">{card.details}</p>
    )}
  </article>
);
