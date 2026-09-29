import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Which part of the editor this guards, for the message. */
  area: string;
  children: ReactNode;
}

/**
 * Keeps one failing part of the editor from blanking the whole page. The project stays open and
 * saved; "Back to the editor" draws the part again.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null; stack: string }> {
  state = { error: null as Error | null, stack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area}]`, error, info.componentStack);
    this.setState({ stack: `${error.stack ?? error.message}\n\nIn:${info.componentStack ?? ''}` });
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-panel" role="alert">
        <b>Something went wrong in the {this.props.area}.</b>
        <p className="small">Your project is still open and saved. {error.message}</p>
        <div className="btn-row">
          <button className="primary" onClick={() => this.setState({ error: null, stack: '' })}>Back to the editor</button>
          <button onClick={() => void navigator.clipboard?.writeText(`${this.props.area}: ${stack || error.message}`)} title="Copy the technical details to send to whoever maintains this editor">
            Copy details
          </button>
        </div>
      </div>
    );
  }
}
