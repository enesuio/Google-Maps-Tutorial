import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { api, ApiError, describeError, PHOTO_MAX_BYTES } from '../api/client';
import type { Photo, PhotoKind, TeamView } from '../api/types';
import { Header } from '../components/Header';
import { Toast } from '../components/Toast';
import { daysBetween, formatShortDate, isValidISODate } from '../lib/dates';

const KINDS: PhotoKind[] = ['start', 'progress', 'end'];

function kindLabel(kind: PhotoKind, lengthDays: number): string {
  return kind === 'start' ? 'Day 1' : kind === 'end' ? `Day ${lengthDays}` : 'Progress';
}

/** Private progress photos (T14): grid, full-screen viewer, Day 1 vs latest compare. */
export function PhotosScreen() {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [team, setTeam] = useState<TeamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // add flow
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [kind, setKind] = useState<PhotoKind>('progress');
  const [date, setDate] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // viewer
  const [open, setOpen] = useState<Photo | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.photos(), api.team()])
      .then(([p, t]) => {
        if (cancelled) return;
        setPhotos(p.photos);
        setTeam(t);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // Object URL for the preview; revoke when it changes or the sheet closes.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const today = team?.today ?? null;
  const startDate = team?.challenge.startDate ?? null;
  const lengthDays = team?.challenge.lengthDays ?? 45;
  const hasStart = photos?.some((p) => p.kind === 'start') ?? false;

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ''; // so picking the same file again fires onChange
    if (!f) return;
    setSheetError(null);
    if (f.size > PHOTO_MAX_BYTES) {
      setToast('That photo is too large (max 12 MB).');
      return;
    }
    setFile(f);
    setKind(hasStart ? 'progress' : 'start');
    setDate(today ?? '');
  }

  function closeSheet() {
    if (uploading) return;
    setFile(null);
    setSheetError(null);
  }

  async function upload() {
    if (!file || uploading || !today) return;
    if (!isValidISODate(date) || (startDate && date < startDate) || date > today) {
      setSheetError('Pick a day between Day 1 and today.');
      return;
    }
    setUploading(true);
    setSheetError(null);
    const form = new FormData();
    form.append('date', date);
    form.append('kind', kind);
    form.append('photo', file, file.name);
    try {
      const saved = await api.uploadPhoto(form);
      setPhotos((ps) => [saved, ...(ps ?? [])]);
      setFile(null);
      setToast('Photo saved. Only you can see it.');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) return;
      setSheetError(describeError(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove(photo: Photo) {
    if (deleting) return;
    if (!window.confirm('Delete this photo? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.deletePhoto(photo.id);
      setPhotos((ps) => (ps ?? []).filter((p) => p.id !== photo.id));
      setOpen(null);
    } catch (err: unknown) {
      if (!(err instanceof ApiError && err.status === 401)) setToast(describeError(err));
    } finally {
      setDeleting(false);
    }
  }

  const dayOf = (d: string) => (startDate ? daysBetween(startDate, d) + 1 : null);
  const caption = (p: Photo) => {
    const n = dayOf(p.date);
    const k = kindLabel(p.kind, lengthDays);
    return p.kind === 'progress' && n !== null ? `Day ${n}` : k;
  };

  // Compare: the Day 1 photo against the latest later photo, when both exist.
  const start = photos?.find((p) => p.kind === 'start') ?? null;
  const latest =
    start && photos
      ? (photos.find((p) => p.id !== start.id && (p.date > start.date || (p.date === start.date && p.createdAt > start.createdAt))) ?? null)
      : null;

  return (
    <div className="app">
      <Header day={team?.day ?? null} lengthDays={team?.challenge.lengthDays ?? null} />
      <main className="main">
        <div className="photos-head">
          <div>
            <h1 className="page-title photos-title">Photos</h1>
            <p className="muted photos-private">Only you can see these.</p>
          </div>
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={loading || !today}>
            Add photo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Choose a photo"
            tabIndex={-1}
            onChange={onPick}
          />
        </div>
        {loading && (
          <p className="muted loading" role="status">
            Loading…
          </p>
        )}
        {error && (
          <div className="notice" role="alert">
            <p>{error}</p>
          </div>
        )}
        {photos && photos.length === 0 && (
          <div className="notice">
            <p>No photos yet. A Day 1 photo is the one you will be glad to have on Day {lengthDays}.</p>
          </div>
        )}
        {start && latest && (
          <section className="compare" aria-labelledby="compare-title">
            <h2 className="section-title" id="compare-title">
              Compare
            </h2>
            <div className="compare-row">
              {[start, latest].map((p, i) => (
                <button key={p.id} type="button" className="compare-cell" onClick={() => setOpen(p)}>
                  <img src={p.url} alt={`${caption(p)}, ${formatShortDate(p.date)}`} loading="lazy" />
                  <span className="compare-caption">
                    <strong>{i === 0 ? 'Day 1' : caption(p)}</strong>
                    <span className="muted"> · {formatShortDate(p.date)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {photos && photos.length > 0 && (
          <ul className="photo-grid" aria-label="Your photos">
            {photos.map((p) => (
              <li key={p.id}>
                <button type="button" className="photo-cell" onClick={() => setOpen(p)}>
                  <img src={p.url} alt={`${caption(p)}, ${formatShortDate(p.date)}`} loading="lazy" />
                  <span className="photo-caption">
                    <strong>{caption(p)}</strong>
                    <span>{formatShortDate(p.date)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Toast message={toast} onDismiss={() => setToast(null)} />

      {file && today && (
        <AddSheet
          preview={preview}
          kind={kind}
          date={date}
          min={startDate ?? today}
          max={today}
          lengthDays={lengthDays}
          uploading={uploading}
          error={sheetError}
          onKind={setKind}
          onDate={setDate}
          onCancel={closeSheet}
          onUpload={() => void upload()}
        />
      )}
      {open && (
        <Viewer
          photo={open}
          title={`${caption(open)} · ${formatShortDate(open.date)}`}
          kind={kindLabel(open.kind, lengthDays)}
          deleting={deleting}
          onClose={() => setOpen(null)}
          onDelete={() => void remove(open)}
        />
      )}
    </div>
  );
}

// ---- add sheet ----

interface SheetProps {
  preview: string | null;
  kind: PhotoKind;
  date: string;
  min: string;
  max: string;
  lengthDays: number;
  uploading: boolean;
  error: string | null;
  onKind: (k: PhotoKind) => void;
  onDate: (d: string) => void;
  onCancel: () => void;
  onUpload: () => void;
}

function AddSheet({ preview, kind, date, min, max, lengthDays, uploading, error, onKind, onDate, onCancel, onUpload }: SheetProps) {
  const titleId = useId();
  const dateId = useId();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h2 className="sheet-title" id={titleId}>
          Add a photo
        </h2>
        <div className="sheet-body">
          {preview && <img className="sheet-preview" src={preview} alt="" />}
          <div className="sheet-fields">
            <div className="segmented" role="group" aria-label="Kind of photo">
              {KINDS.map((k) => (
                <button key={k} type="button" className="segment" aria-pressed={kind === k} onClick={() => onKind(k)} disabled={uploading}>
                  {kindLabel(k, lengthDays)}
                </button>
              ))}
            </div>
            <label className="sheet-label" htmlFor={dateId}>
              Taken on
            </label>
            <input
              id={dateId}
              type="date"
              className="date-input"
              min={min}
              max={max}
              value={date}
              disabled={uploading}
              onChange={(e) => onDate(e.target.value)}
            />
          </div>
        </div>
        {uploading && (
          <div className="progress" role="progressbar" aria-label="Uploading" aria-valuetext="Uploading…">
            <span className="progress-bar" />
          </div>
        )}
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="link-button" onClick={onCancel} disabled={uploading}>
            Cancel
          </button>
          <button type="button" className="button" onClick={onUpload} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- full-screen viewer ----

interface ViewerProps {
  photo: Photo;
  title: string;
  kind: string;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}

function Viewer({ photo, title, kind, deleting, onClose, onDelete }: ViewerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="viewer-bar">
        <div className="viewer-title" id={titleId}>
          <strong>{title}</strong>
          <span className="viewer-kind">{kind}</span>
        </div>
        <button ref={closeRef} type="button" className="viewer-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="viewer-stage" onClick={onClose}>
        <img className="viewer-img" src={photo.url} alt={title} onClick={(e) => e.stopPropagation()} />
      </div>
      <div className="viewer-actions">
        <button type="button" className="link-button viewer-delete" onClick={onDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}
