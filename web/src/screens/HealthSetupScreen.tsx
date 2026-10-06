import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { TeamView } from '../api/types';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';

/**
 * Static instructions for the iOS Shortcuts personal automation that posts steps and active
 * calories to `POST /api/import` every evening (T11). The URL shown is this deployment's origin.
 */
export function HealthSetupScreen() {
  const [team, setTeam] = useState<TeamView | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .team()
      .then((t) => {
        if (!cancelled) setTeam(t);
      })
      .catch(() => {
        // The header simply shows no day counter.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const importUrl = `${origin}/api/import`;

  return (
    <div className="app">
      <Header day={team?.day ?? null} lengthDays={team?.challenge.lengthDays ?? null} />
      <main className="main">
        <h1 className="page-title">Set up the Shortcut</h1>
        <p className="setup-intro">
          An iOS Shortcut sends your steps and active calories here at 8:30 pm every day. It takes about five minutes
          to build once. You need an import token from the <Link to="/">Apple Health section</Link> on the today
          screen.
        </p>

        <ol className="steps">
          <li className="step">
            <h2 className="step-title">Start a personal automation</h2>
            <p>
              Open <strong>Shortcuts</strong>, tap <strong>Automation</strong>, then <strong>+</strong>. Choose{' '}
              <strong>Time of Day</strong>, set <strong>8:30 PM</strong>, <strong>Daily</strong>, pick{' '}
              <strong>Run Immediately</strong> and turn <strong>Notify When Run</strong> off. Tap <strong>Next</strong>{' '}
              and choose <strong>New Blank Automation</strong>.
            </p>
          </li>
          <li className="step">
            <h2 className="step-title">Read today's steps</h2>
            <p>
              Add <strong>Find Health Samples</strong>. Set Type to <strong>Steps</strong>, add a filter{' '}
              <strong>Start Date is Today</strong>, and set <strong>Group By: Day</strong>. Then add{' '}
              <strong>Calculate Statistics</strong> → <strong>Sum</strong> of the samples. Rename that result{' '}
              <code>steps</code>.
            </p>
          </li>
          <li className="step">
            <h2 className="step-title">Read today's active energy</h2>
            <p>
              Repeat the two actions with Type <strong>Active Energy</strong>, unit <strong>kcal</strong>. Rename the
              sum <code>activeKcal</code>.
            </p>
          </li>
          <li className="step">
            <h2 className="step-title">Send both numbers here</h2>
            <p>
              Add <strong>Get Contents of URL</strong> and fill it in exactly like this (numbers are examples; pick the
              two sums as variables):
            </p>
            <dl className="kv">
              <dt>URL</dt>
              <dd>
                <code className="code-block">{importUrl}</code>
              </dd>
              <dt>Method</dt>
              <dd>
                <code>POST</code>
              </dd>
              <dt>Header</dt>
              <dd>
                <code className="code-block">Authorization: Bearer &lt;your token&gt;</code>
              </dd>
              <dt>Request Body</dt>
              <dd>
                <span className="muted">JSON, two Number fields:</span>
                <pre className="code-block">
                  <code>{'{"steps": 8421, "activeKcal": 512}'}</code>
                </pre>
              </dd>
            </dl>
            <p className="muted small">
              Shortcuts sometimes sends numbers as text; the server accepts that too. A date is optional and defaults to
              today in Toronto.
            </p>
          </li>
          <li className="step">
            <h2 className="step-title">Test it</h2>
            <p>
              Tap <strong>Run</strong> (▶) in the automation. Back on the today screen your steps goal shows the value with
              "from Apple Health", and the Apple Health section shows the last import.
            </p>
          </li>
          <li className="step">
            <h2 className="step-title">If the token leaks</h2>
            <p>
              Tap <strong>Rotate token</strong> in the Apple Health section. The old token stops working immediately;
              paste the new one into the Shortcut's header.
            </p>
          </li>
        </ol>
        <p>
          <Link to="/" className="back-link">
            ← Back to today
          </Link>
        </p>
      </main>
      <Footer current="other" />
    </div>
  );
}
