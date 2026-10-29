import { useState } from 'react';
import { answerQuestion } from '../api';
import { Button } from './fj';
import type { Question } from '../types';

/**
 * Each open question with its options as buttons. The option key is what the bot's buttons send too, so
 * the server resolves it the same way. After an answer the caller refetches.
 */
export function QuestionButtons({ questions, onAnswered }: { questions: Question[]; onAnswered: () => void | Promise<void> }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});

  if (questions.length === 0) return null;

  async function answer(q: Question, key: string) {
    setBusy(q.id);
    try {
      const r = await answerQuestion(q.id, key);
      setNotes((n) => ({ ...n, [q.id]: r.message || 'Saved.' }));
      await onAnswered();
    } catch (e) {
      setNotes((n) => ({ ...n, [q.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="sa-questions">
      {questions.map((q) => (
        <li key={q.id} className="sa-question">
          <div className="sa-question-text">{q.question}</div>
          {q.options.length > 0 ? (
            <div className="sa-question-options">
              {q.options.map((o) => (
                <Button key={o.key} variant="secondary" size="sm" disabled={busy !== null} onClick={() => void answer(q, o.key)}>
                  {o.label}
                </Button>
              ))}
            </div>
          ) : (
            <div className="sa-muted">Answer this one in Telegram (it needs a typed reply).</div>
          )}
          {notes[q.id] ? <div className="sa-question-note">{notes[q.id]}</div> : null}
        </li>
      ))}
    </ul>
  );
}
