import { useId, useState } from 'react';
import type { Cheer } from '../api/types';
import { CHEER_EMOJI } from '../api/types';
import { CHEER_NOTE_MAX } from '../lib/cheers';

// ---- received cheers: chips under the card header ----

interface ChipsProps {
  cheers: Cheer[];
  meId: number;
  nameOf: (userId: number) => string;
  onDelete?: (id: number) => void;
}

export function CheerChips({ cheers, meId, nameOf, onDelete }: ChipsProps) {
  if (cheers.length === 0) return null;
  return (
    <ul className="cheer-chips" aria-label="Cheers received">
      {cheers.map((c) => {
        const mine = c.fromUserId === meId;
        const pending = c.id < 0;
        return (
          <li key={c.id} className="cheer-chip" data-mine={mine} data-pending={pending}>
            <span className="cheer-emoji" aria-hidden="true">
              {c.emoji}
            </span>
            <span className="cheer-text">
              <span className="sr-only">{c.emoji} </span>
              from {mine ? 'you' : nameOf(c.fromUserId)}
              {c.note && <span className="cheer-note"> · {c.note}</span>}
            </span>
            {mine && onDelete && !pending && (
              <button
                type="button"
                className="cheer-delete"
                aria-label={`Delete your ${c.emoji} cheer`}
                onClick={() => onDelete(c.id)}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---- send a cheer: one row of emoji + an "add a note" expander ----

interface BarProps {
  toName: string;
  disabled?: boolean;
  onCheer: (emoji: string, note: string | null) => void;
}

export function CheerBar({ toName, disabled = false, onCheer }: BarProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const trimmed = note.trim();
  const tooLong = trimmed.length > CHEER_NOTE_MAX;

  function send(emoji: string) {
    if (disabled || tooLong) return;
    onCheer(emoji, trimmed ? trimmed : null);
    setNote('');
    setOpen(false);
  }

  return (
    <div className="cheer-bar">
      <div className="cheer-bar-head">
        <span className="cheer-bar-title">Cheer {toName}</span>
        <button
          type="button"
          className="link-button cheer-note-toggle"
          aria-expanded={open}
          aria-controls={noteId}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide note' : 'Add a note'}
        </button>
      </div>
      {open && (
        <div className="cheer-note-wrap">
          <textarea
            id={noteId}
            className="cheer-note-input"
            rows={2}
            maxLength={CHEER_NOTE_MAX + 20}
            placeholder={`A few words for ${toName}…`}
            value={note}
            enterKeyHint="done"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="cheer-note-meta">
            <span className="muted">Tap an emoji to send it with your note</span>
            <span className="cheer-counter" data-over={tooLong} aria-live="polite">
              {trimmed.length}/{CHEER_NOTE_MAX}
            </span>
          </div>
        </div>
      )}
      <div className="cheer-buttons" role="group" aria-label={`Send ${toName} a cheer`}>
        {CHEER_EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            className="cheer-button"
            disabled={disabled || tooLong}
            aria-label={`Send ${e}${trimmed ? ' with your note' : ''}`}
            onClick={() => send(e)}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
