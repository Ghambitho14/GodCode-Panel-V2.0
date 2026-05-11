import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export class AdminErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	componentDidCatch(error, info) {
		if (typeof console !== 'undefined' && console.error) {
			console.error('AdminErrorBoundary', error, info);
		}
	}

	handleRetry = () => {
		const { onRetry } = this.props;
		this.setState({ error: null }, () => {
			if (typeof onRetry === "function") {
				try {
					onRetry();
				} catch {
					/* noop */
				}
			}
		});
	};

	render() {
		const { error } = this.state;
		const { children, tabLabel } = this.props;
		if (error) {
			return (
				<div className="admin-error-boundary glass" style={{ padding: 24, borderRadius: 12, marginTop: 16 }}>
					<div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
						<AlertCircle size={22} color="#f87171" style={{ flexShrink: 0, marginTop: 2 }} />
						<div style={{ minWidth: 0 }}>
							<p style={{ margin: 0, fontWeight: 700 }}>
								{tabLabel ? `Algo salió mal en «${tabLabel}»` : 'Algo salió mal en esta sección'}
							</p>
							<p style={{ margin: '8px 0 0', opacity: 0.85, fontSize: 14 }}>
								Puedes reintentar. Si el problema continúa, recarga la página.
							</p>
							<button
								type="button"
								className="admin-btn secondary"
								onClick={this.handleRetry}
								style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
							>
								<RefreshCw size={16} />
								Reintentar
							</button>
						</div>
					</div>
				</div>
			);
		}
		return children;
	}
}

export default AdminErrorBoundary;
