"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BoardFilters } from "@/components/BoardFilters";
import { BoardPeopleContext } from "@/components/BoardPeople";
import { ChatSidebar } from "@/components/ChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import { NewColumnForm } from "@/components/NewColumnForm";
import { saveBoard } from "@/lib/api";
import {
  addCard,
  addColumn,
  boardLabels,
  columnColor,
  createId,
  deleteCard,
  deleteColumn,
  editCard,
  hasFilters,
  isOverdue,
  localToday,
  matchesFilters,
  moveCard,
  moveColumn,
  noFilters,
  renameColumn,
  type BoardData,
  type CardFields,
} from "@/lib/kanban";

type KanbanBoardProps = {
  boardId: number;
  initialBoard: BoardData;
  initialVersion: number;
  people: string[]; // who can be assigned: the owner, then the members
  username: string; // the signed-in user
};

type Notice = "save-failed" | "conflict" | null;

export const KanbanBoard = ({ boardId, initialBoard, initialVersion, people, username }: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData>(initialBoard);
  const [notice, setNotice] = useState<Notice>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [filters, setFilters] = useState(noFilters);
  const today = localToday();
  const dndContextId = useId();

  // Saving state lives in refs: it changes during async work and never affects rendering.
  const version = useRef(initialVersion); // version of the last board the server confirmed
  const pending = useRef<BoardData | null>(null); // latest board waiting to be saved
  const saving = useRef(false);

  // Replace the board with one from the server (after a conflict or an AI change).
  // Any unsent local change was based on an older board, so it is dropped and the user is told.
  const replaceBoard = (next: BoardData, nextVersion: number) => {
    if (pending.current) {
      setNotice("conflict");
    }
    pending.current = null;
    version.current = Math.max(version.current, nextVersion);
    setBoard(next);
  };

  // Saves run one at a time, each based on the version the previous save returned.
  // Changes made while a save is in flight are combined: only the latest board is sent next.
  const flush = async () => {
    saving.current = true;
    while (pending.current) {
      const next = pending.current;
      pending.current = null;
      const result = await saveBoard(boardId, next, version.current);
      if (result.status === "saved") {
        version.current = Math.max(version.current, result.version);
        setNotice(null);
      } else if (result.status === "conflict") {
        replaceBoard(result.board, result.version);
        setNotice("conflict");
      } else {
        setNotice("save-failed");
      }
    }
    saving.current = false;
  };

  const persist = (next: BoardData) => {
    pending.current = next;
    if (!saving.current) {
      void flush();
    }
  };

  const update = (next: BoardData) => {
    setBoard(next);
    persist(next);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const cardsById = useMemo(() => board.cards, [board.cards]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id) {
      return;
    }

    update({
      ...board,
      columns: moveCard(board.columns, active.id as string, over.id as string),
    });
  };

  // Typing only updates local state; the title is saved on blur / Enter.
  const handleRenameColumn = (columnId: string, title: string) =>
    setBoard(renameColumn(board, columnId, title));

  const handleAddCard = (columnId: string, fields: CardFields) =>
    update(addCard(board, columnId, { ...fields, id: createId("card") }));

  const handleEditCard = (cardId: string, fields: CardFields) =>
    update(editCard(board, cardId, fields));

  const handleDeleteCard = (cardId: string) => update(deleteCard(board, cardId));

  const handleAddColumn = (title: string) =>
    update(addColumn(board, { id: createId("col"), title, cardIds: [] }));

  const handleMoveColumn = (columnId: string, offset: number) =>
    update(moveColumn(board, columnId, offset));

  const handleDeleteColumn = (columnId: string) => update(deleteColumn(board, columnId));

  const activeCard = activeCardId ? cardsById[activeCardId] : null;
  const activeIndex = board.columns.findIndex((column) =>
    column.cardIds.includes(activeCardId ?? "")
  );

  return (
    <BoardPeopleContext.Provider value={{ people, username }}>
      <div className="flex flex-col gap-6">
        <ul aria-label="Columns" className="flex flex-wrap items-center gap-4">
          {board.columns.map((column) => (
            <li
              key={column.id}
              className="flex items-center gap-2 rounded-full bg-[var(--nav-chip)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
            >
              <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
              {column.title}
            </li>
          ))}
        </ul>
        <BoardFilters filters={filters} labels={boardLabels(board)} onChange={setFilters} />
        {notice === "save-failed" && (
          <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
            Could not save your changes. Check that the server is running and try again.
          </p>
        )}
        {notice === "conflict" && (
          <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
            Your board was changed somewhere else, so the latest version has been loaded. Your
            last change may need to be made again.
          </p>
        )}

        <div className="flex flex-col gap-6 2xl:flex-row 2xl:items-start">
          <div className="min-w-0 flex-1">
            <DndContext
              id={dndContextId}
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {/* Columns share the width; past what fits, the row scrolls sideways. */}
              <section className="flex flex-col gap-6 lg:flex-row lg:overflow-x-auto lg:pb-4">
                {board.columns.map((column, index) => (
                  <KanbanColumn
                    key={column.id}
                    column={column}
                    cards={column.cardIds
                      .map((cardId) => board.cards[cardId])
                      .filter((card) => matchesFilters(card, filters))}
                    filtering={hasFilters(filters)}
                    color={columnColor(index)}
                    isFirst={index === 0}
                    isLast={index === board.columns.length - 1}
                    today={today}
                    onRename={handleRenameColumn}
                    onRenameDone={() => persist(board)}
                    onAddCard={handleAddCard}
                    onDeleteCard={handleDeleteCard}
                    onEditCard={handleEditCard}
                    onMove={handleMoveColumn}
                    onDelete={handleDeleteColumn}
                  />
                ))}
                <NewColumnForm onAdd={handleAddColumn} />
              </section>
              <DragOverlay>
                {activeCard && activeIndex !== -1 ? (
                  <div className="w-[260px]">
                    <KanbanCardPreview
                      card={activeCard}
                      color={columnColor(activeIndex)}
                      overdue={activeIndex !== board.columns.length - 1 && isOverdue(activeCard, today)}
                    />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          </div>
          {/* The backend has already saved the board the AI returns, so it is not saved again. */}
          <ChatSidebar boardId={boardId} onBoardUpdate={replaceBoard} />
        </div>
      </div>
    </BoardPeopleContext.Provider>
  );
};
