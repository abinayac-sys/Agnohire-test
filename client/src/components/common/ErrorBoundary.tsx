import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Defaults to a centered "something went wrong" card. */
  fallback?: ReactNode;
  /** Reset boundary when this value changes (e.g. route key) so navigation recovers. */
  resetKey?: unknown;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Catches render/runtime errors in the subtree and shows a recoverable fallback
 * instead of unmounting the whole React tree to a blank screen. Mounted both at
 * the app root and around the routed <Outlet/> so a single page crash never
 * takes down the shell/navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidUpdate(prev: Props): void {
    // Recover automatically when the reset key changes (e.g. user navigates away).
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: undefined });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleDismiss = (): void => {
    this.setState({ hasError: false, message: undefined });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-muted text-2xl font-bold text-danger">
          !
        </div>
        <div>
          <h2 className="font-heading text-xl font-bold text-text-primary">Something went wrong</h2>
          <p className="mt-1 max-w-md text-sm text-text-muted">
            This section ran into an unexpected error. You can try again, or reload the app.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={this.handleDismiss}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-raised"
          >
            Try again
          </button>
          <button
            onClick={this.handleReload}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg shadow-elev-1 transition-colors hover:bg-accent-hover"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
