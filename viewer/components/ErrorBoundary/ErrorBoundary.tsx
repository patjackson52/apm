'use client';
import { Component, type ReactNode } from 'react';
import s from './ErrorBoundary.module.css';

interface Props { children: ReactNode; fallback?: ReactNode; onRetry?: () => void; }
interface State { hasError: boolean; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };
  static getDerivedStateFromError(): State { return { hasError: true }; }
  componentDidCatch(error: unknown) { console.error('[ErrorBoundary]', error); }
  reset = () => { this.setState({ hasError: false }); this.props.onRetry?.(); };
  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className={s.fallback} role="alert">
        <p>Something went wrong rendering this section.</p>
        <button type="button" className={s.retry} onClick={this.reset}>Retry</button>
      </div>
    );
  }
}
