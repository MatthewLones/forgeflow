import { Outlet } from 'react-router-dom';
import { RunProvider } from '../context/RunContext';
import { Component, type ErrorInfo, type ReactNode } from 'react';

class DashboardErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RunDashboard] CRASH:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-red-50 p-8">
          <h2 className="text-lg font-bold text-red-700 mb-2">Dashboard Error</h2>
          <pre className="text-xs text-red-600 bg-white border border-red-200 rounded p-4 max-w-2xl overflow-auto whitespace-pre-wrap">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function RunLayout() {
  return (
    <DashboardErrorBoundary>
      <RunProvider>
        <Outlet />
      </RunProvider>
    </DashboardErrorBoundary>
  );
}
