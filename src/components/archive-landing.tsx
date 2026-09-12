import type { ReactNode } from "react";

export function ArchiveLanding({ slides, children }: { slides: string[]; children: ReactNode }) {
  return (
    <main className="gate-shell landing-shell">
      <div className="landing-slideshow" aria-hidden="true">
        {slides.map((id, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- this deliberately uses a small, public, server-made derivative.
          <img key={id} src={`/api/landing-media/${encodeURIComponent(id)}`} alt="" style={{ "--slide": index } as React.CSSProperties} />
        ))}
      </div>
      <div className="landing-shade" aria-hidden="true" />
      {children}
      <footer className="landing-footer">Архивариус-разработчик · <a href="mailto:denjah@gmail.com">denjah@gmail.com</a></footer>
    </main>
  );
}
