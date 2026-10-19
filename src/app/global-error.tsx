"use client";

// Errors in the root layout itself: replaces the whole document, so it brings its own html and body.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en-SG">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f7f5f1", color: "#34363e", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 16 }}>
          <h1 style={{ fontSize: 28 }}>Something went wrong</h1>
          <p>Please try again. If it keeps happening, let an admin know.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "10px 20px", borderRadius: 999, border: 0, background: "#2f7f9b", color: "#fff" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
