import React from "react";
import { BookOpen, Download, Link2, ArrowUpRight } from "lucide-react";
import "./welcome-guide.css";

export function WelcomeGuide({ busy, onDemo, onImport, onConnect }) {
  const paths = [
    {
      title: "Try demo",
      description:
        "One concept, one calculation, one coding exercise. Get a feel for your study desk.",
      Icon: BookOpen,
      action: onDemo,
      className: "demo",
    },
    {
      title: "Import cards",
      description:
        "Bring an Anki deck into your local library. Your originals stay yours.",
      Icon: Download,
      action: onImport,
      className: "import",
    },
    {
      title: "Connect learning",
      description:
        "Choose your knowledge base and connect an assistant to capture what you learn.",
      Icon: Link2,
      action: onConnect,
      className: "connect",
    },
  ];
  return (
    <section className="welcome-guide" aria-labelledby="welcome-title">
      <div className="welcome-intro">
        <span className="eyebrow">A place for what stays</span>
        <h2 id="welcome-title">Turn learning into recall.</h2>
        <p>
          Your study desk starts here. Choose a first step; you can come back to
          the others anytime.
        </p>
      </div>
      <div className="welcome-paths">
        {paths.map(({ title, description, Icon, action, className }, index) => (
          <button
            className={`welcome-path ${className}`}
            key={title}
            disabled={busy}
            onClick={action}
            aria-label={title}
          >
            <span className="welcome-path-top" aria-hidden="true">
              <span className="welcome-path-icon">
                <Icon size={22} strokeWidth={1.6} />
              </span>
              <span className="welcome-path-number">0{index + 1}</span>
            </span>
            <strong>
              {title}
              <ArrowUpRight size={17} aria-hidden="true" />
            </strong>
            <span className="welcome-path-description">{description}</span>
          </button>
        ))}
      </div>
      <p className="welcome-footnote">
        On your Mac. No Recall account required.
      </p>
    </section>
  );
}
