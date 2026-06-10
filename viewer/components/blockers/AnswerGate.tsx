"use client";
import { useState } from 'react';
import { useAnswerGate } from '@/lib/api/mutations';
import s from './blockers.module.css';

/**
 * Live answer control for a human gate. Renders one button per declared option (the
 * common case) plus an optional note. Posts via useAnswerGate (CSRF-guarded); on success
 * the hook invalidates gates/status so the answered gate drops from the list. Errors are
 * shown inline. This is the template the other write affordances follow.
 */
export function AnswerGate({ blocker, options }: { blocker: string; options: string[] }) {
  const [note, setNote] = useState('');
  const answer = useAnswerGate();
  if (options.length === 0) return null;
  return (
    <span className={s.answer}>
      {options.map((choice) => (
        <button
          key={choice}
          type="button"
          className={s.answerBtn}
          disabled={answer.isPending}
          onClick={() => answer.mutate({ blocker, choice, note: note.trim() || undefined })}
        >
          {choice}
        </button>
      ))}
      <input
        className={s.note}
        placeholder="note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={answer.isPending}
        aria-label="answer note"
      />
      {answer.isError ? <span className={s.answerErr} role="alert">{answer.error.message}</span> : null}
    </span>
  );
}
