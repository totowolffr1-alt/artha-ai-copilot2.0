import React from 'react';

interface State { hasError: boolean; error: string }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, error: err.message };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 40, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20
        }}>
          <div style={{ fontSize: 48 }}>⚠️</div>
          <h2 style={{ color: '#fff', fontSize: 20 }}>Page crashed — but your data is safe!</h2>
          <p style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
            {this.state.error}
          </p>
          <button onClick={() => this.setState({ hasError: false, error: '' })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
