import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Error en la cabina" };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-error">
          <strong>CRHIS no pudo arrancar</strong>
          <p>{this.state.error}</p>
          <button className="ghost" onClick={() => location.reload()}>
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
