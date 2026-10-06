export function SetupNeeded() {
  return (
    <div className="app setup">
      <main className="setup-main">
        <img src="/icon.svg" alt="" width="72" height="72" className="setup-icon" />
        <h1 className="setup-title">Open your setup link</h1>
        <p className="setup-text">
          This app has no passwords. Open the personal setup link Enes sent you on this phone to sign in.
        </p>
        <p className="muted setup-hint">Already opened it? Make sure you are using the same browser.</p>
      </main>
    </div>
  );
}
