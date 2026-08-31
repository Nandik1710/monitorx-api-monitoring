import type { ReactElement } from "react";

export function App(): ReactElement {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">Developer reliability platform</p>
        <h1 id="page-title">Monitor-X</h1>
        <p className="lede">
          A secure foundation for defining API checks, running them
          asynchronously, and learning from reliability history.
        </p>
        <div className="status" role="status">
          <span className="status-dot" aria-hidden="true" />
          Foundation online
        </div>
      </section>
      <section className="cards" aria-label="Foundation services">
        <article className="card">
          <p className="card-label">API</p>
          <h2>Stateless control plane</h2>
          <p>
            Health endpoints and strict configuration validation are ready for
            the next phase.
          </p>
        </article>
        <article className="card">
          <p className="card-label">Worker</p>
          <h2>Async execution boundary</h2>
          <p>
            Outbound monitored requests will run here, outside browser and API
            request lifecycles.
          </p>
        </article>
        <article className="card">
          <p className="card-label">Local stack</p>
          <h2>PostgreSQL · Redis · Mailpit</h2>
          <p>
            Reproducible local services are defined in Docker Compose with
            pinned image tags.
          </p>
        </article>
      </section>
      <footer>Monitor-X · local foundation · v0.1.0</footer>
    </main>
  );
}
