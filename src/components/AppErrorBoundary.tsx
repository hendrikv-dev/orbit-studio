import { Component, type ErrorInfo, type ReactNode } from "react";
import { resetLocalAppStateAndReload } from "../lib/appStateReset";

interface AppErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  variant?: "app" | "renderer";
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Orbit Studio recovered from a runtime error.", error, errorInfo);
  }

  private handleTryAgain = () => {
    this.setState({ error: null });
  };

  render() {
    const { children, fallbackMessage, fallbackTitle, variant = "app" } = this.props;
    const { error } = this.state;

    if (!error) {
      return children;
    }

    return (
      <section className={`runtime-error-screen ${variant}`} role="alert">
        <div className="runtime-error-panel">
          <p className="runtime-error-kicker">
            {variant === "renderer" ? "Renderer recovery" : "Startup recovery"}
          </p>
          <h1>{fallbackTitle ?? "Orbit Studio hit a startup error"}</h1>
          <p>
            {fallbackMessage ??
              "The app stopped while loading. Your local browser state can be reset without touching project files."}
          </p>
          <pre>{error.message || "Unknown runtime error"}</pre>
          <div className="runtime-error-actions">
            <button type="button" onClick={this.handleTryAgain}>
              Try again
            </button>
            <button type="button" className="danger-button" onClick={resetLocalAppStateAndReload}>
              Reset local app state
            </button>
          </div>
        </div>
      </section>
    );
  }
}
