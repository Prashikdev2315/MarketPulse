'use client';

import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary catches render-time exceptions in any child component tree
 * and shows a clean recovery UI instead of a blank white page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center min-h-[200px] rounded-xl p-6 text-center gap-4"
          style={{
            background: 'rgba(239,68,68,0.05)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <AlertTriangle size={32} style={{ color: '#ef4444', opacity: 0.7 }} />
          <div>
            <p className="text-sm font-semibold text-white/80">
              {this.props.fallbackMessage ?? 'Something went wrong'}
            </p>
            {this.state.error && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {this.state.error.message}
              </p>
            )}
          </div>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
            style={{
              background: 'rgba(79,156,249,0.12)',
              color: '#4f9cf9',
              border: '1px solid rgba(79,156,249,0.25)',
            }}
          >
            <RefreshCw size={11} /> Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
